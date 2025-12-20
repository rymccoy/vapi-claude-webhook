// Helper function to check availability
async function checkAvailability(date, startTime, endTime) {
  try {
    // Ensure times are in HH:MM format (24-hour)
    const formatTime = (time) => {
      // If already in HH:MM format, return as-is
      if (/^\d{2}:\d{2}$/.test(time)) return time;
      
      // If in H:MM format, pad the hour
      if (/^\d{1}:\d{2}$/.test(time)) return time.padStart(5, '0');
      
      // Handle "7 PM", "7:00 PM", etc.
      const match = time.match(/(\d{1,2}):?(\d{2})?\s*(AM|PM)/i);
      if (match) {
        let hour = parseInt(match[1]);
        const minute = match[2] || '00';
        const period = match[3].toUpperCase();
        
        if (period === 'PM' && hour !== 12) hour += 12;
        if (period === 'AM' && hour === 12) hour = 0;
        
        return `${hour.toString().padStart(2, '0')}:${minute}`;
      }
      
      return time;
    };
    
    const formattedStart = formatTime(startTime);
    const formattedEnd = formatTime(endTime);
    
    // Create datetime strings in ISO format with timezone
    const timeMin = new Date(`${date}T${formattedStart}:00-05:00`).toISOString();
    const timeMax = new Date(`${date}T${formattedEnd}:00-05:00`).toISOString();

    console.log(`Checking availability: ${timeMin} to ${timeMax}`);

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
