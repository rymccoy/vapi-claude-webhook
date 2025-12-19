import express from 'express';
import { google } from 'googleapis';
import 'dotenv/config';

const app = express();
app.use(express.json());

// Google Calendar Setup
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

oauth2Client.setCredentials({
  refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
});

const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

// Helper function to check availability
async function checkAvailability(date, startTime, endTime) {
  try {
    const timeMin = new Date(`${date}T${startTime}:00`).toISOString();
    const timeMax = new Date(`${date}T${endTime}:00`).toISOString();

    const response = await calendar.events.list({
      calendarId: 'primary',
      timeMin: timeMin,
      timeMax: timeMax,
      singleEvents: true,
    });

    const isAvailable = response.data.items.length === 0;
    return {
      available: isAvailable,
      message: isAvailable 
        ? `Yes, ${date} from ${startTime} to ${endTime} is available.`
        : `Sorry, ${date} from ${startTime} to ${endTime} is already booked.`
    };
  } catch (error) {
    console.error('Error checking availability:', error);
    return {
      available: false,
      message: 'Unable to check calendar availability at this time.'
    };
  }
}

// Helper function to book appointment
async function bookAppointment(summary, date, startTime, endTime, description = '') {
  try {
    const event = {
      summary: summary,
      description: description,
      start: {
        dateTime: new Date(`${date}T${startTime}:00`).toISOString(),
        timeZone: 'America/New_York',
      },
      end: {
        dateTime: new Date(`${date}T${endTime}:00`).toISOString(),
        timeZone: 'America/New_York',
      },
    };

    const response = await calendar.events.insert({
      calendarId: 'primary',
      resource: event,
    });

    return {
      success: true,
      message: `Appointment booked successfully for ${date} from ${startTime} to ${endTime}.`,
      eventId: response.data.id,
      link: response.data.htmlLink
    };
  } catch (error) {
    console.error('Error booking appointment:', error);
    return {
      success: false,
      message: 'Unable to book the appointment at this time. Please try again.'
    };
  }
}

// Health check endpoint
app.get('/', (req, res) => {
  res.json({ status: 'Voice AI Secretary with Calendar is running!' });
});

// OAuth callback endpoint (for initial Google auth setup)
app.get('/oauth/callback', async (req, res) => {
  const code = req.query.code;
  try {
    const { tokens } = await oauth2Client.getToken(code);
    console.log('Refresh Token:', tokens.refresh_token);
    res.send(`
      <h1>Success!</h1>
      <p>Copy this refresh token to your Render environment variables:</p>
      <code>${tokens.refresh_token}</code>
      <p>Variable name: GOOGLE_REFRESH_TOKEN</p>
    `);
  } catch (error) {
    res.status(500).send('Error getting token: ' + error.message);
  }
});

// Start OAuth flow (visit once to get refresh token)
app.get('/auth', (req, res) => {
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/calendar'],
  });
  res.redirect(authUrl);
});

// Main webhook endpoint for Vapi Custom Tools
app.post('/webhook', async (req, res) => {
  console.log('========================================');
  console.log('WEBHOOK RECEIVED');
  console.log('Body:', JSON.stringify(req.body, null, 2));
  console.log('========================================');
  
  const { message } = req.body;
  
  // Check if this is a tool call request
  if (!message?.toolCalls || message.toolCalls.length === 0) {
    console.log('Not a tool call - ignoring');
    return res.json({ received: true });
  }
  
  // Process each tool call
  const results = [];
  
  for (const toolCall of message.toolCalls) {
    const { id: toolCallId, function: func } = toolCall;
    const { name, arguments: args } = func;
    
    console.log(`Processing tool: ${name}`);
    console.log(`Arguments:`, args);
    
    let result;
    
    try {
      // Parse arguments (they come as a string)
      const parsedArgs = typeof args === 'string' ? JSON.parse(args) : args;
      
      if (name === 'check_availability') {
        const { date, start_time, end_time } = parsedArgs;
        const availabilityResult = await checkAvailability(date, start_time, end_time);
        result = availabilityResult.message;
        
      } else if (name === 'book_appointment') {
        const { summary, date, start_time, end_time, description } = parsedArgs;
        const bookingResult = await bookAppointment(summary, date, start_time, end_time, description);
        result = bookingResult.message;
        
      } else {
        result = `Unknown tool: ${name}`;
      }
      
      console.log(`Result: ${result}`);
      
      results.push({
        toolCallId: toolCallId,
        result: result
      });
      
    } catch (error) {
      console.error(`Error executing ${name}:`, error);
      results.push({
        toolCallId: toolCallId,
        result: `Error: ${error.message}`
      });
    }
  }
  
  console.log('Sending results:', results);
  res.json({ results });
});

// Handle status updates and other webhook types
app.post('/webhook/status', (req, res) => {
  console.log('Status update:', req.body);
  res.json({ received: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`📅 Calendar integration ready`);
  console.log(`🔗 Webhook URL: https://vapi-claude-webhook.onrender.com/webhook`);
});
