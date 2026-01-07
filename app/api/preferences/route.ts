import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/utils/prisma';
// Migration will be imported dynamically if needed

export async function GET(request: NextRequest) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!prisma) {
    return NextResponse.json({ preferences: null });
  }

  // Extract userId from NextAuth session
  const userId = session.user.id;

  try {
    const preferences = await prisma.userPreference.findUnique({
      where: {
        userId: userId, // Use userId from NextAuth
      },
      select: {
        autoPlayEnabled: true,
      },
    });

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

  if (!prisma) {
    return NextResponse.json({ success: true }); // Silently fail if not configured
  }

  // Extract userId from NextAuth session (already hashed)
  let userId = session.user.id;

  // Check if user has email in session and migrate old format data if needed
  if (session.user.email && userId.startsWith('usr_')) {
    try {
      const { migrateUserDataByEmail } = await import('@/utils/userIdMigration');
      const migrationResult = await migrateUserDataByEmail(session.user.email, userId);
      if (migrationResult.entriesMigrated > 0 || migrationResult.preferencesMigrated) {
        console.log(`[Migration] Migrated data for ${session.user.email.substring(0, 5)}***: ${migrationResult.entriesMigrated} entries, preferences: ${migrationResult.preferencesMigrated}`);
      }
    } catch (migrationError) {
      console.error('[Migration] Failed to migrate user data by email', migrationError);
    }
  }

  try {
    const body = await request.json();
    const { auto_play_enabled } = body;

    // Upsert preferences using userId from NextAuth
    await prisma.userPreference.upsert({
      where: {
        userId: userId, // Use userId from NextAuth
      },
      update: {
        autoPlayEnabled: auto_play_enabled ?? true,
      },
      create: {
        userId: userId, // Use userId from NextAuth
        autoPlayEnabled: auto_play_enabled ?? true,
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to save preferences:', error);
    return NextResponse.json({ error: 'Failed to save preferences' }, { status: 500 });
  }
}
