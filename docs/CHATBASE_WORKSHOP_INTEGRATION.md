# Chatbase Real-Time Workshop Integration

This guide explains how to integrate real-time workshop event data from your Firebase database into Chatbase using **Custom Actions**.

## Overview

Instead of relying on static trained data, Chatbase can now fetch live workshop information directly from your Firebase database whenever a customer asks questions like:

- "What's your next workshop?"
- "Do you still have slots for the matcha workshop?"
- "What workshops are available in October?"
- "Is there a workshop this weekend?"

## Architecture

```
Customer Question
    ↓
Chatbase AI (trained data + context)
    ↓
Triggers Custom Action
    ↓
Firebase Cloud Function API
    ↓
Queries Firebase Realtime Data (workshop_sessions collection)
    ↓
Returns JSON Response
    ↓
Chatbase formats response for customer
```

## Available API Endpoints

Your Firebase Functions now expose these endpoints for Chatbase to call:

### 1. **Get Upcoming Workshops**
```
GET https://YOUR-PROJECT.cloudfunctions.net/api/workshops/upcoming
```

**Query Parameters:**
- `eventType` (optional) - Filter by event type (e.g., "matcha workshop")
- `limit` (optional, default: 10, max: 50) - Number of sessions to return
- `days_ahead` (optional, default: 90, max: 365) - Look ahead this many days
- `format` (optional: "json" or "text") - Response format

**Example Requests:**
```bash
# Get next 10 upcoming workshops
GET /api/workshops/upcoming

# Get next 5 matcha workshops
GET /api/workshops/upcoming?eventType=matcha%20workshop&limit=5

# Get text-formatted response for Chatbase
GET /api/workshops/upcoming?format=text&limit=3
```

**Example Response (JSON format):**
```json
{
  "ok": true,
  "data": [
    {
      "sessionId": "matcha-workshop-2026-10-15-14:00",
      "eventType": "Matcha Workshop",
      "sessionLabel": "Beginner Class",
      "date": "2026-10-15",
      "startTime": "14:00",
      "endTime": "16:30",
      "timezone": "Asia/Manila",
      "capacity": 10,
      "bookedSeats": 3,
      "availableSeats": 7,
      "status": "open"
    }
  ],
  "count": 1,
  "queryDate": "2026-09-16"
}
```

**Example Response (text format):**
```json
{
  "ok": true,
  "text": "• Matcha Workshop - Beginner Class\n  📅 Tue, Oct 15 at 14:00\n  🪑 7 slots available (out of 10)",
  "count": 1,
  "sessions": [...]
}
```

---

### 2. **Get Next Available Workshop**
```
GET https://YOUR-PROJECT.cloudfunctions.net/api/workshops/next
```

**Query Parameters:**
- `eventType` (optional) - Filter by event type

**Use Case:** "When is your next workshop?"

**Example Response:**
```json
{
  "ok": true,
  "data": {
    "sessionId": "matcha-workshop-2026-10-15-14:00",
    "eventType": "Matcha Workshop",
    "date": "2026-10-15",
    "startTime": "14:00",
    "availableSeats": 7,
    "capacity": 10
  },
  "message": "Next available: Matcha Workshop on 2026-10-15 at 14:00"
}
```

---

### 3. **Search Workshops**
```
GET https://YOUR-PROJECT.cloudfunctions.net/api/workshops/search
```

**Query Parameters:**
- `q` or `query` (optional) - Text search query
- `date` (optional) - Specific date (YYYY-MM-DD format)
- `month` (optional) - Month filter (YYYY-MM format)
- `format` (optional: "json" or "text") - Response format

**Example Requests:**
```bash
# Search for "matcha" workshops
GET /api/workshops/search?q=matcha

# Get workshops on a specific date
GET /api/workshops/search?date=2026-10-15

# Get all workshops in October 2026
GET /api/workshops/search?month=2026-10
```

---

### 4. **Get Event Details**
```
GET https://YOUR-PROJECT.cloudfunctions.net/api/workshops/event/:eventType
```

**Example Request:**
```bash
GET /api/workshops/event/Matcha%20Workshop
```

**Example Response:**
```json
{
  "ok": true,
  "data": {
    "eventId": "uuid-here",
    "eventName": "Matcha Workshop",
    "venue": "Matchanese Cafe",
    "address": "123 Main St, Manila",
    "durationHours": 2.5,
    "notes": "Beginner-friendly matcha preparation workshop",
    "status": "open"
  }
}
```

---

## Setting Up Chatbase Custom Actions

### Step 1: Deploy Your Firebase Functions

First, ensure your functions are deployed:

```bash
cd chatbase-leads-dashboard
firebase deploy --only functions
```

After deployment, note your function URL:
```
https://YOUR-PROJECT.cloudfunctions.net/api
```

### Step 2: Configure Chatbase Custom Action

1. **Go to Chatbase Dashboard**
   - Navigate to your chatbot settings
   - Find the "Actions" or "Custom Actions" section

2. **Create New Action: "Get Upcoming Workshops"**

   **Action Name:** `get_upcoming_workshops`
   
   **Description:** 
   ```
   Fetch real-time workshop availability and schedule from the database. 
   Use this when customers ask about upcoming workshops, available slots, 
   or workshop schedules.
   ```
   
   **Trigger Keywords/Phrases:**
   - "workshop"
   - "next workshop"
   - "upcoming workshops"
   - "available slots"
   - "workshop schedule"
   - "matcha workshop"
   - "do you have slots"
   
   **HTTP Method:** `GET`
   
   **Endpoint URL:** 
   ```
   https://YOUR-PROJECT.cloudfunctions.net/api/workshops/upcoming?format=text&limit=5
   ```
   
   **Headers:** (if needed for authentication)
   ```json
   {
     "x-admin-token": "your-admin-token-here"
   }
   ```
   
   **Response Handling:**
   - Use the `text` field from the response
   - Chatbase will automatically integrate this into the conversation

3. **Create New Action: "Get Next Workshop"**

   **Action Name:** `get_next_workshop`
   
   **Description:**
   ```
   Find the next available workshop session. Use when customers ask 
   "when is your next workshop" or similar immediate availability questions.
   ```
   
   **Endpoint URL:**
   ```
   https://YOUR-PROJECT.cloudfunctions.net/api/workshops/next
   ```

4. **Create New Action: "Search Workshops by Date"**

   **Action Name:** `search_workshops`
   
   **Description:**
   ```
   Search for workshops on a specific date or month. Use when customers 
   ask about workshops on specific dates or time periods.
   ```
   
   **Endpoint URL (with parameters):**
   ```
   https://YOUR-PROJECT.cloudfunctions.net/api/workshops/search?format=text&query={{query}}&date={{date}}&month={{month}}
   ```
   
   **Parameters:**
   - `query` - Text to search for
   - `date` - Specific date (YYYY-MM-DD)
   - `month` - Month (YYYY-MM)

### Step 3: Test Your Integration

Test the action in Chatbase by asking:

1. **"What's your next workshop?"**
   - Should trigger `get_next_workshop` action
   - Returns the next available session with date and slots

2. **"Do you still have slots for the matcha workshop?"**
   - Should trigger `get_upcoming_workshops` action with eventType filter
   - Returns sessions filtered by "matcha workshop"

3. **"What workshops do you have in October?"**
   - Should trigger `search_workshops` action with month=2026-10
   - Returns all October workshops

4. **"Are there any workshops this weekend?"**
   - Chatbase should parse the date and use `search_workshops`
   - Returns workshops for the specific dates

---

## Advanced Configuration

### Authentication

If you want to secure your API endpoints, add authentication:

1. **In your Firebase Functions** (already implemented in `index.js`):
   ```javascript
   function requireAdminToken(req, res) {
     const expected = process.env.ADMIN_API_TOKEN;
     if (!expected) {
       res.status(500).json({ message: "Missing ADMIN_API_TOKEN env" });
       return false;
     }
     if (req.headers["x-admin-token"] !== expected) {
       res.status(401).json({ message: "Unauthorized" });
       return false;
     }
     return true;
   }
   ```

2. **Set environment variable:**
   ```bash
   firebase functions:config:set admin.token="your-secret-token"
   ```

3. **Add to Chatbase Action Headers:**
   ```json
   {
     "x-admin-token": "your-secret-token"
   }
   ```

### CORS Configuration

The API is already configured to allow requests from:
- `https://admin.matchanese.com`
- `https://matchanese.com`
- `https://www.matchanese.com`

To add Chatbase's domain:

```javascript
const CORS_ALLOWED_ORIGINS = new Set([
  "https://admin.matchanese.com",
  "https://matchanese.com",
  "https://www.matchanese.com",
  "https://www.chatbase.co",  // Add Chatbase
  // ... other origins
]);
```

### Rate Limiting

Consider implementing rate limiting for public endpoints:

```javascript
const rateLimit = require('express-rate-limit');

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});

app.use('/workshops/', limiter);
```

---

## Training Chatbase

Update your Chatbase knowledge base with context about the action:

### Add to Chatbase Training Data:

```markdown
# Workshop Availability System

We have a real-time workshop booking system. When customers ask about 
workshop availability, schedules, or slots, you can access live data 
from our database using the following actions:

## When to Use Actions

1. **Use `get_upcoming_workshops` when:**
   - Customer asks "what workshops do you have"
   - Customer asks about workshop schedule
   - Customer wants to see upcoming events
   - Customer asks about slot availability

2. **Use `get_next_workshop` when:**
   - Customer asks "when is your next workshop"
   - Customer wants the immediate next available session

3. **Use `search_workshops` when:**
   - Customer asks about workshops on a specific date
   - Customer asks about workshops in a specific month
   - Customer wants to search for a particular type of workshop

## Example Conversations

Customer: "Do you still have slots for the matcha workshop?"
You: [Trigger get_upcoming_workshops action with eventType=matcha workshop]
     "Let me check our current availability... [Action returns live data]
      We have 7 slots available for our Matcha Workshop on October 15th at 2:00 PM!"

Customer: "What's your next workshop?"
You: [Trigger get_next_workshop action]
     "[Action returns data] Our next available workshop is the Matcha Workshop 
      on October 15th at 2:00 PM. We have 7 out of 10 slots still available!"

Customer: "What workshops do you have in October?"
You: [Trigger search_workshops with month=2026-10]
     "[Action returns October workshops] Here are our workshops in October: ..."
```

---

## Monitoring and Debugging

### Check Firebase Function Logs

```bash
firebase functions:log
```

### Test API Directly

```bash
# Test upcoming workshops
curl "https://YOUR-PROJECT.cloudfunctions.net/api/workshops/upcoming?format=text&limit=3"

# Test next workshop
curl "https://YOUR-PROJECT.cloudfunctions.net/api/workshops/next"

# Test search
curl "https://YOUR-PROJECT.cloudfunctions.net/api/workshops/search?q=matcha&format=text"
```

### Common Issues

1. **CORS errors:** 
   - Add Chatbase domain to `CORS_ALLOWED_ORIGINS` in `index.js`

2. **Authentication errors:**
   - Check that your `x-admin-token` header matches the environment variable

3. **Empty responses:**
   - Verify you have workshop sessions in your Firebase database
   - Check that sessions have `date >= today`
   - Ensure sessions have `status !== 'cancelled'` and available slots

4. **Action not triggering:**
   - Review your trigger keywords in Chatbase
   - Check that the action description is clear
   - Test with exact phrases from your trigger list

---

## Benefits of This Integration

✅ **Always Up-to-Date:** Customers get real-time availability, not stale data  
✅ **Reduces Manual Work:** No need to constantly retrain Chatbase with new workshop dates  
✅ **Better Customer Experience:** Accurate slot counts and immediate booking availability  
✅ **Seamless Integration:** Works with your existing Shopify + Lazy Appointment Booking setup  
✅ **Flexible Queries:** Customers can ask in natural language, Chatbase handles the parsing  

---

## Next Steps

1. ✅ Deploy the Firebase Functions (done with this code)
2. ⏳ Configure Chatbase Custom Actions
3. ⏳ Test with sample queries
4. ⏳ Train Chatbase on when to trigger actions
5. ⏳ Monitor usage and refine triggers
6. ⏳ Optionally add booking links or integration

---

## Support

If you need help:
- Check Firebase Function logs for errors
- Test API endpoints directly with curl
- Review Chatbase action logs in their dashboard
- Ensure your workshop data is properly formatted in Firebase

---

## Future Enhancements

- Add booking functionality through Chatbase
- Send session reminders via Chatbase
- Integrate with payment system
- Add waitlist functionality
- Notify customers when new workshops are added
