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

// Helper function to normalize time format to HH:MM 24-hour
function normalizeTime(time) {
  console.log(`Normalizing time input: "${time}"`);
  
  // If already in HH:MM format, validate and return
  const hhmmMatch = time.match(/^(\d{1,2}):(\d{2})$/);
  if (hhmmMatch) {
    const hour = parseInt(hhmmMatch[1]);
    const minute = hhmmMatch[2];
    if (hour >= 0 && hour < 24) {
      const normalized = `${hour.toString().padStart(2, '0')}:${minute}`;
      console.log(`Already in 24hr format, normalized to: ${normalized}`);
      return normalized;
    }
  }
  
  // Handle 12-hour format with AM/PM
  const ampmMatch = time.match(/(\d{1,2}):?(\d{2})?\s*(AM|PM)/i);
  if (ampmMatch) {
    let hour = parseInt(ampmMatch[1]);
    const minute = ampmMatch[2] || '00';
    const period = ampmMatch[3].toUpperCase();
    
    if (period === 'PM' && hour !== 12) hour += 12;
    if (period === 'AM' && hour === 12) hour = 0;
    
    const normalized = `${hour.toString().padStart(2, '0')}:${minute}`;
    console.log(`Converted ${time} to 24hr format: ${normalized}`);
    return normalized;
  }
  
  throw new Error(`Invalid time format: ${time}. Expected HH:MM or H:MM AM/PM`);
}

// Helper function to check availability
async function checkAvailability(date, startTime, endTime) {
  try {
    console.log('=== CHECK AVAILABILITY ===');
    console.log(`Raw inputs - date: ${date}, startTime: ${startTime}, endTime: ${endTime}`);
    
    const formattedStart = normalizeTime(startTime);
    const formattedEnd = normalizeTime(endTime);
    
    const timeMin = new Date(`${date}T${formattedStart}:00`).toISOString();
    const timeMax = new Date(`${date}T${formattedEnd}:00`).toISOString();

    console.log(`Formatted times: ${formattedStart} to ${formattedEnd}`);
    console.log(`ISO format: ${timeMin} to ${timeMax}`);

    const calendarId = process.env.GOOGLE_CALENDAR_ID || 'primary';
    
    console.log('===== GOOGLE CALENDAR API REQUEST =====');
    console.log('Calendar ID:', calendarId);
    console.log('timeMin:', timeMin);
    console.log('timeMax:', timeMax);
    console.log('Requested date:', date);
    console.log('Requested time range:', startTime, 'to', endTime);
    
    const response = await calendar.events.list({
      calendarId: calendarId,
      timeMin: timeMin,
      timeMax: timeMax,
      singleEvents: true,
    });
    
    console.log('API Response - Total events found:', response.data.items?.length || 0);
    if (response.data.items && response.data.items.length > 0) {
      response.data.items.forEach((event, index) => {
        console.log(`Event ${index + 1}:`, {
          summary: event.summary,
          start: event.start,
          end: event.end
        });
      });
    }

    const events = response.data.items || [];
    console.log(`Found ${events.length} events in the calendar during this period`);
    
    // Check if any event actually overlaps with the requested time slot
    const requestStart = new Date(timeMin);
    const requestEnd = new Date(timeMax);
    
    const overlappingEvents = events.filter(event => {
      const eventStart = new Date(event.start.dateTime || event.start.date);
      const eventEnd = new Date(event.end.dateTime || event.end.date);
      
      // Events overlap if: event starts before requested end AND event ends after requested start
      return eventStart < requestEnd && eventEnd > requestStart;
    });
    
    console.log(`Found ${overlappingEvents.length} overlapping events`);
    
    if (overlappingEvents.length > 0) {
      console.log('Overlapping events:', overlappingEvents.map(e => ({
        summary: e.summary,
        start: e.start.dateTime || e.start.date,
        end: e.end.dateTime || e.end.date
      })));
    }
    
    const isAvailable = overlappingEvents.length === 0;
    
    // Debug info that will appear in VAPI logs
    const debugInfo = ` [DEBUG: Found ${events.length} total events, ${overlappingEvents.length} overlapping]`;
    
    return {
      available: isAvailable,
      message: isAvailable 
        ? `Yes, ${date} from ${startTime} to ${endTime} is available.${debugInfo}`
        : `Sorry, ${date} from ${startTime} to ${endTime} is already booked.${debugInfo}`
    };
  } catch (error) {
    console.error('Error checking availability:', error);
    return {
      available: false,
      message: 'Unable to check calendar availability at this time. Error: ' + error.message
    };
  }
}

// Helper function to book appointment
async function bookAppointment(summary, date, startTime, endTime, description = '') {
  try {
    console.log('=== BOOK APPOINTMENT ===');
    console.log(`Raw inputs - summary: ${summary}, date: ${date}, startTime: ${startTime}, endTime: ${endTime}`);
    
    const formattedStart = normalizeTime(startTime);
    const formattedEnd = normalizeTime(endTime);
    
    const event = {
      summary: summary,
      description: description,
      start: {
        dateTime: new Date(`${date}T${formattedStart}:00`).toISOString(),
        timeZone: 'America/New_York',
      },
      end: {
        dateTime: new Date(`${date}T${formattedEnd}:00`).toISOString(),
        timeZone: 'America/New_York',
      },
    };

    console.log('Creating event:', JSON.stringify(event, null, 2));
    
    const calendarId = process.env.GOOGLE_CALENDAR_ID || 'primary';

    const response = await calendar.events.insert({
      calendarId: calendarId,
      resource: event,
    });

    console.log('Event created successfully:', response.data.id);

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
      message: 'Unable to book the appointment at this time. Error: ' + error.message
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
    
    console.log(`\n>>> Processing tool: ${name}`);
    console.log(`>>> Tool Call ID: ${toolCallId}`);
    console.log(`>>> Raw Arguments:`, args);
    
    let result;
    
    try {
      // Parse arguments (they come as a string)
      const parsedArgs = typeof args === 'string' ? JSON.parse(args) : args;
      console.log(`>>> Parsed Arguments:`, parsedArgs);
      
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
      
      console.log(`>>> Result: ${result}`);
      
      results.push({
        toolCallId: toolCallId,
        result: result
      });
      
    } catch (error) {
      console.error(`>>> Error executing ${name}:`, error);
      results.push({
        toolCallId: toolCallId,
        result: `Error: ${error.message}`
      });
    }
  }
  
  console.log('\n=== SENDING RESPONSE ===');
  console.log('Results:', JSON.stringify(results, null, 2));
  console.log('========================================\n');
  
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
