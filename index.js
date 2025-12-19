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

// OAuth endpoints
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

app.get('/auth', (req, res) => {
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/calendar'],
  });
  res.redirect(authUrl);
});

// Main conversation handler
async function handleConversation(req, res) {
  console.log('========================================');
  console.log('REQUEST PATH:', req.path);
  console.log('REQUEST BODY:', JSON.stringify(req.body, null, 2));
  console.log('========================================');
  
  const { messages } = req.body;
  
  // Validate messages
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    console.error('ERROR: No valid messages array!');
    console.error('Received:', messages);
    return res.status(400).json({ 
      error: { 
        message: 'No valid messages provided',
        received: req.body
      } 
    });
  }
  
  // Extract system message and conversation messages
  const systemMessage = messages.find(m => m.role === 'system')?.content || 
    'You are a professional voice secretary.';
  
  const claudeMessages = messages
    .filter(m => m.role !== 'system')
    .map(m => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content
    }));
  
  console.log('System message:', systemMessage);
  console.log('Claude messages:', JSON.stringify(claudeMessages, null, 2));
  
  if (claudeMessages.length === 0) {
    console.error('ERROR: No non-system messages!');
    return res.status(400).json({ 
      error: { 
        message: 'At least one non-system message required' 
      } 
    });
  }
  
  // Define calendar tools
  const tools = [
    {
      name: 'check_availability'
