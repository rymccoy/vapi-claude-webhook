import { google } from 'googleapis';
import 'dotenv/config';

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

oauth2Client.setCredentials({
  refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
});

const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

async function testCalendar() {
  try {
    console.log('Testing Google Calendar API access...\n');
    
    // Get calendar list
    console.log('1. Fetching calendar list...');
    const calendarList = await calendar.calendarList.list();
    console.log('✅ Successfully connected to Google Calendar');
    console.log(`Found ${calendarList.data.items.length} calendars\n`);
    
    // Get today's events
    console.log('2. Fetching today\'s events...');
    const today = new Date();
    const startOfDay = new Date(today.setHours(0, 0, 0, 0)).toISOString();
    const endOfDay = new Date(today.setHours(23, 59, 59, 999)).toISOString();
    
    const events = await calendar.events.list({
      calendarId: 'primary',
      timeMin: startOfDay,
      timeMax: endOfDay,
      singleEvents: true,
      orderBy: 'startTime'
    });
    
    console.log(`✅ Found ${events.data.items.length} events today:\n`);
    
    if (events.data.items.length === 0) {
      console.log('No events scheduled for today.');
    } else {
      events.data.items.forEach((event, index) => {
        const start = event.start.dateTime || event.start.date;
        console.log(`${index + 1}. ${event.summary || 'No title'}`);
        console.log(`   Time: ${start}`);
      });
    }
    
    console.log('\n✅ Google Calendar API is working correctly!');
    
  } catch (error) {
    console.error('❌ Error testing calendar:', error.message);
    if (error.code === 403) {
      console.error('\n⚠️  Calendar API might not be enabled. Enable it at:');
      console.error('https://console.cloud.google.com/apis/library/calendar-json.googleapis.com');
    }
  }
}

testCalendar();
