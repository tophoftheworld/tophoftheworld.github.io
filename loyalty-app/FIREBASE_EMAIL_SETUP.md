# Firebase Email Authentication Setup

## What You Need to Configure in Firebase Console

### 1. Enable Email Link Authentication

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Select your project: `manila-matcha-fest`
3. Go to **Authentication** → **Sign-in method**
4. Enable **Email link (passwordless sign-in)**
5. Click **Save**

### 2. Configure Authorized Domains

1. In **Authentication** → **Settings** → **Authorized domains**
2. Add your domain where the app is hosted:
   - If using GitHub Pages: `yourusername.github.io`
   - If using custom domain: `yourdomain.com`
   - For local testing: `localhost`

### 3. Configure Action Code Settings (Optional)

For better UX, you can customize the email template:

1. Go to **Authentication** → **Templates**
2. Click on **Email link sign-in**
3. Customize the email subject and content
4. Recommended subject: "Sign in to Manila Matcha Fest"
5. Recommended content: "Click the link below to sign in to your Manila Matcha Fest account"

### 4. Dynamic Links (Optional - for mobile apps)

If you plan to create mobile apps later:

1. Go to **Dynamic Links** in Firebase Console
2. Create a new dynamic link domain: `manila-matcha-fest.page.link`
3. This will enable better mobile app integration

## How It Works

1. **User enters email** → Clicks "Send Login Link"
2. **Firebase sends email** with secure sign-in link
3. **User clicks link** → Automatically signed in
4. **App detects sign-in** → Loads user's stamps

## Cost

- **Email sending**: ~$0.0001 per email (very cheap!)
- **Firebase Auth**: Free tier includes 10,000 authentications/month
- **Total cost**: Practically free for your use case

## Testing

1. Enter your email in the app
2. Check your email for the login link
3. Click the link to sign in
4. You should be automatically logged in and see your stamps

## Troubleshooting

### Email not received
- Check spam folder
- Verify domain is authorized in Firebase
- Check Firebase Console logs for errors

### Link not working
- Ensure the domain is properly configured
- Check that the app URL matches the authorized domain

### Authentication errors
- Check browser console for error messages
- Verify Firebase configuration is correct
- Ensure all Firebase SDK imports are working

## Security Benefits

- **No passwords** to store or manage
- **Secure links** that expire automatically
- **Email verification** built-in
- **Rate limiting** handled by Firebase
- **Fraud protection** through Firebase's systems
