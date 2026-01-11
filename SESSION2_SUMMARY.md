# Session 2 Complete: Authentication with Google OAuth

## 🎉 What You Built

- ✅ Google OAuth integration
- ✅ NextAuth.js v5 configuration
- ✅ Protected routes with middleware
- ✅ Login page with Server Actions
- ✅ Session management (server + client)
- ✅ TypeScript type safety for sessions
- ✅ User storage in MongoDB via Prisma

---

## 📁 Files Created (Copy to Your Project)

### 1. **auth.ts** (Root)
```bash
cp SESSION2_auth_config.ts auth.ts
```
- NextAuth configuration
- Google OAuth provider
- Prisma adapter
- JWT callbacks

### 2. **app/api/auth/[...nextauth]/route.ts**
```bash
mkdir -p app/api/auth/[...nextauth]
cp SESSION2_auth_route.ts app/api/auth/[...nextauth]/route.ts
```
- Auth API endpoints
- Handles OAuth callback

### 3. **middleware.ts** (Root)
```bash
cp SESSION2_middleware.ts middleware.ts
```
- Protects routes
- Redirects to login if not authenticated

### 4. **app/login/page.tsx**
```bash
mkdir -p app/login
cp SESSION2_login_page.tsx app/login/page.tsx
```
- Login page with Google button
- Server Action for sign-in

### 5. **components/SessionProvider.tsx**
```bash
mkdir -p components
cp SESSION2_session_provider.tsx components/SessionProvider.tsx
```
- Client-side session provider
- Enables useSession() hook

### 6. **types/next-auth.d.ts**
```bash
mkdir -p types
cp SESSION2_auth_types.ts types/next-auth.d.ts
```
- TypeScript type extensions
- Adds user.id to session

### 7. **app/layout.tsx**
```bash
cp SESSION2_layout.tsx app/layout.tsx
```
- Root layout
- Wraps app with SessionProvider

### 8. **app/page.tsx**
```bash
cp SESSION2_home_page.tsx app/page.tsx
```
- Home page (protected)
- Shows user info + logout

### 9. **app/globals.css**
```bash
cp SESSION2_globals.css app/globals.css
```
- Tailwind imports
- Global styles

---

## 🔧 Installation Steps

```bash
# 1. Install dependencies
npm install next-auth@beta @auth/prisma-adapter

# 2. Copy all files from above

# 3. Add to .env
GOOGLE_CLIENT_ID="your-client-id.apps.googleusercontent.com"
GOOGLE_CLIENT_SECRET="your-secret"
NEXTAUTH_SECRET="run: openssl rand -base64 32"
NEXTAUTH_URL="http://localhost:3000"

# 4. Update Prisma schema (if using MongoDB template)
# Already done if you used NEW_PROJECT_SCHEMA_MONGODB.prisma

# 5. Push database changes
npx prisma db push

# 6. Start dev server
npm run dev
```

---

## 🧪 Testing Authentication

### 1. **Start the app**
```bash
npm run dev
```

### 2. **Visit http://localhost:3000**
- Should redirect to /login (not authenticated)

### 3. **Click "Continue with Google"**
- Redirects to Google OAuth
- Approve access
- Redirects back to /

### 4. **You should see:**
- Welcome message with your name
- Your email
- Your user ID (MongoDB ObjectId)
- Sign Out button

### 5. **Check database**
```bash
npx prisma studio
```
- Open `users` collection
- You should see your user record

### 6. **Test logout**
- Click "Sign Out"
- Redirects to /login
- Try visiting / → redirects to /login (protected)

### 7. **Test middleware**
- While logged out, try: http://localhost:3000
- Should redirect to login
- After login, try /login → redirects to home

---

## 🎓 What You Learned

### **1. OAuth Flow**
- How OAuth 2.0 authorization code flow works
- Why we redirect to Google and back
- How user data is retrieved and stored

### **2. NextAuth.js Architecture**
- Providers (Google, GitHub, etc.)
- Adapters (connects to database)
- Callbacks (customize auth flow)
- Session strategies (JWT vs database)

### **3. Middleware Pattern**
- Runs before every request
- Protects routes without code in each page
- Edge runtime (fast, global)

### **4. Server Actions**
- Functions that run on server
- Triggered by form submission
- Secure (no client-side exposure)

### **5. React Context Pattern**
- SessionProvider wraps app
- useSession() accesses context
- Server vs client auth access

### **6. TypeScript Module Augmentation**
- Extending third-party types
- Adding custom fields (user.id)
- Type safety throughout app

---

## 💬 Interview Talking Points

### **Q: "Walk me through the authentication flow"**
> "When a user clicks 'Sign in with Google', a Server Action calls NextAuth's signIn() function. This redirects to Google's OAuth page with our client ID. The user approves, and Google redirects back to our callback URL with an authorization code. NextAuth exchanges this code for user data, checks if the user exists in our MongoDB database via Prisma, creates or updates the user record, generates a JWT token with the user ID, and sets it as an HTTP-only cookie. The middleware then allows access to protected pages."

### **Q: "Why JWT instead of database sessions?"**
> "JWT sessions are stateless - the session data is in the encrypted cookie, so we don't need a database query on every request. This is faster and scales better for serverless environments. The trade-off is you can't immediately revoke sessions, but for this app, the security/performance balance is right. For banking apps, I'd use database sessions."

### **Q: "How do you secure against CSRF attacks?"**
> "NextAuth includes CSRF protection by default. Every state-changing request requires a CSRF token from /api/auth/csrf. Server Actions handle this automatically. The session cookie is also httpOnly and secure, so JavaScript can't access it."

### **Q: "What happens if Google OAuth is down?"**
> "Users can't log in, but existing sessions continue working (JWT in cookie). For production, I'd add error handling with retry logic and show a status message. I'd also set up monitoring to alert me if OAuth starts failing."

### **Q: "How would you add email/password authentication?"**
> "NextAuth makes this easy - add Credentials provider to the providers array, create a custom login form, hash passwords with bcrypt, and store in the database. But OAuth is more secure (no password storage) and better UX (no password reset flow needed)."

---

## 🐛 Troubleshooting

### **Error: "NEXTAUTH_SECRET is not set"**
```bash
# Generate a secret
openssl rand -base64 32

# Add to .env
NEXTAUTH_SECRET="your-generated-secret"
```

### **Error: "redirect_uri_mismatch"**
- Check Google Console redirect URIs
- Must exactly match: http://localhost:3000/api/auth/callback/google
- No trailing slashes

### **Error: "PrismaClient is not configured"**
- Run: npx prisma generate
- Run: npx prisma db push
- Restart dev server

### **Error: "Module not found: @auth/prisma-adapter"**
```bash
npm install @auth/prisma-adapter
```

### **Session is null / undefined**
- Check middleware matcher (should include /)
- Check .env has all required variables
- Clear cookies and try again
- Check browser console for errors

---

## 🎯 Next Session Preview

**Session 3: Basic Journal UI**

We'll build:
- Journal entry textarea
- Mood selector
- Character count
- Save to database
- Real-time updates

You'll learn:
- React state management
- Form handling
- Database CRUD operations
- Optimistic updates

---

## 📚 Additional Resources

- [NextAuth.js Docs](https://next-auth.js.org)
- [Google OAuth Guide](https://developers.google.com/identity/protocols/oauth2)
- [Next.js Middleware](https://nextjs.org/docs/app/building-your-application/routing/middleware)
- [Server Actions](https://nextjs.org/docs/app/building-your-application/data-fetching/server-actions)

---

**Estimated time spent: 2 hours**
**Progress: 2/8 sessions complete (25%)**

🎉 Great job! Authentication is the foundation of the app. Everything else builds on this.
