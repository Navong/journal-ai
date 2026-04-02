import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/app/auth';
// Migration will be imported dynamically if needed
import { connectMongo } from '@/app/utils/mongodb';
import { UserPreference } from '@/app/models/UserPreference';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const mongo = await connectMongo();
  if (!mongo) return NextResponse.json({ preferences: null });

  // Extract userId from NextAuth session
  const userId = session.user.id;

  try {
    const preferences = await UserPreference.findOne({ userId }).lean();

    return NextResponse.json({
      preferences: preferences
        ? { auto_play_enabled: preferences.autoPlayEnabled ?? true }
        : null,
    });
  } catch (error) {
    console.error('Failed to fetch preferences:', error);
    return NextResponse.json({ preferences: null });
  }
}

export async function POST(request: NextRequest) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const mongo = await connectMongo();
  if (!mongo) return NextResponse.json({ success: true }); // Silently fail if not configured

  // Extract userId from NextAuth session (already hashed)
  let userId = session.user.id;

  try {
    const body = await request.json();
    const { auto_play_enabled } = body;

    await UserPreference.findOneAndUpdate(
      { userId },
      { $set: { autoPlayEnabled: auto_play_enabled ?? true } },
      { upsert: true, new: true }
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to save preferences:', error);
    return NextResponse.json({ error: 'Failed to save preferences' }, { status: 500 });
  }
}
