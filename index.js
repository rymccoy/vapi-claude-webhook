import Anthropic from '@anthropic-ai/sdk';
import express from 'express';
import { google } from 'googleapis';
import 'dotenv/config';

const app = express();
app.use(express.json());

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Google Calendar Setup
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

// Set credentials (you'll get this token after OAuth flow)
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

    return response.data.items.length === 0;
  } catch (error) {
    console.error('Error checking availability:', error);
    return false;
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
        timeZone: 'America/New_York', // Change to your timezone
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
      eventId: response.data.id,
      link: response.data.htmlLink,
    };
  } catch (error) {
    console.error('Error booking appointment:', error);
    return { success: false, error: error.message };
  }
}

// Health check endpoint
app.get('/', (req, res) => {
  res.json({ status: 'Voice AI Secretary with Calendar is running!' });
});

// OAuth callback endpoint (for initial setup)
app.get('/oauth/callback', async (req, res) => {
  const code = req.query.code;
  try {
    const { tokens } = await oauth2Client.getToken(code);
    console.log('Refresh Token:', tokens.refresh_token);
    res.send(`
      <h1>Success!</h1>
      <p>Copy this refresh token to your .env file:</p>
      <code>${tokens.refresh_token}</code>
    `);
  } catch (error) {
    res.status(500).send('Error getting token: ' + error.message);
  }
});

// Start OAuth flow (visit this once to get your refresh token)
app.get('/auth', (req, res) => {
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/calendar'],
  });
  res.redirect(authUrl);
});

// Main webhook endpoint for Vapi
app.post('/webhook', async (req, res) => {
  console.log('Received webhook:', JSON.stringify(req.body, null, 2));
  
  const { message } = req.body;
  
  // Vapi sends messagesOpenAIFormatted - use it directly!
  const messages = message?.messagesOpenAIFormatted || [];
  
  // Filter out system messages and convert to Claude format
  const claudeMessages = messages
    .filter(m => m.role !== 'system')
    .map(m => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content
    }));
  
  // Get system message from Vapi (this is your prompt from Vapi dashboard)
  const systemMessage = messages.find(m => m.role === 'system')?.content || 
    'You are a professional voice secretary. Keep responses brief (1-2 sentences).';
  
  // Define tools for Claude (function calling)
  const tools = [
    {
      name: 'check_availability',
      description: 'Check if a time slot is available in the calendar. Use this before booking appointments.',
      input_schema: {
        type: 'object',
        properties: {
          date: {
            type: 'string',
            description: 'Date in YYYY-MM-DD format'
          },
          start_time: {
            type: 'string',
            description: 'Start time in HH:MM format (24-hour)'
          },
          end_time: {
            type: 'string',
            description: 'End time in HH:MM format (24-hour)'
          }
        },
        required: ['date', 'start_time', 'end_time']
      }
    },
    {
      name: 'book_appointment',
      description: 'Book an appointment in the calendar. Only use after checking availability.',
      input_schema: {
        type: 'object',
        properties: {
          summary: {
            type: 'string',
            description: 'Title/summary of the appointment'
          },
          date: {
            type: 'string',
            description: 'Date in YYYY-MM-DD format'
          },
          start_time: {
            type: 'string',
            description: 'Start time in HH:MM format (24-hour)'
          },
          end_time: {
            type: 'string',
            description: 'End time in HH:MM format (24-hour)'
          },
          description: {
            type: 'string',
            description: 'Additional details about the appointment'
          }
        },
        required: ['summary', 'date', 'start_time', 'end_time']
      }
    }
  ];
  
  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 200,
      system: systemMessage,
      messages: claudeMessages,
      tools: tools,
    });

    console.log('Claude response:', JSON.stringify(response, null, 2));

    // Handle tool use (function calling)
    if (response.stop_reason === 'tool_use') {
      const toolUse = response.content.find(block => block.type === 'tool_use');
      let toolResult;

      if (toolUse.name === 'check_availability') {
        const { date, start_time, end_time } = toolUse.input;
        const isAvailable = await checkAvailability(date, start_time, end_time);
        toolResult = {
          available: isAvailable,
          message: isAvailable 
            ? `Yes, ${date} from ${start_time} to ${end_time} is available.`
            : `Sorry, ${date} from ${start_time} to ${end_time} is not available.`
        };
      } else if (toolUse.name === 'book_appointment') {
        const { summary, date, start_time, end_time, description } = toolUse.input;
        toolResult = await bookAppointment(summary, date, start_time, end_time, description);
      }

      // Send tool result back to Claude for final response
      const finalResponse = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 150,
        system: systemMessage,
        messages: [
          ...claudeMessages,
          { role: 'assistant', content: response.content },
          {
            role: 'user',
            content: [
              {
                type: 'tool_result',
                tool_use_id: toolUse.id,
                content: JSON.stringify(toolResult),
              },
            ],
          },
        ],
        tools: tools,
      });

      const textContent = finalResponse.content.find(block => block.type === 'text');
      const reply = textContent ? textContent.text : 'Done!';
      
      console.log('Final response:', reply);
      
      // Return in format Vapi expects
      return res.json({ 
        results: [{
          role: 'assistant',
          content: reply
        }]
      });
    }

    // Regular text response (no tool use)
    const textContent = response.content.find(block => block.type === 'text');
    const reply = textContent ? textContent.text : "I'm here to help!";
    
    console.log('Text response:', reply);
    
    // Return in format Vapi expects
    res.json({ 
      results: [{
        role: 'assistant',
        content: reply
      }]
    });
    
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ 
      error: error.message
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
