import axios from 'axios';
import { eachDayOfInterval, parseISO, addDays, nextDay } from 'date-fns';
import { formatInTimeZone, toZonedTime } from 'date-fns-tz';
import fs from 'fs'; // Import the fs module

// Timezone for Central Time (CT)
const timeZone = 'America/Chicago';

// Function to calculate the start date of the NFL season (Thursday after the first Monday in September)
function getNFLSeasonStart(year) {
    const september1 = new Date(year, 8, 1); // September is month 8 (0-indexed)
    const firstMonday = nextDay(september1, 1); // 1 represents Monday
    return addDays(firstMonday, 3); // Thursday is 3 days after Monday
}

// Function to calculate the date range for a given NFL week
function getWeekDateRange(year, week) {
    const seasonStart = getNFLSeasonStart(year);
    const weekStart = addDays(seasonStart, (week - 1) * 7);
    const weekEnd = addDays(weekStart, 4); // NFL weeks typically run from Thursday to Monday
    return { start: weekStart, end: weekEnd };
}

// Function to fetch the NFL schedule from ESPN API for a single date
async function fetchScheduleForDate(date) {
    try {
        const formattedDate = formatInTimeZone(date, 'UTC', 'yyyyMMdd');
        const url = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=${formattedDate}`;
        const response = await axios.get(url);
        return response.data.events || [];
    } catch (error) {
        console.error(`Error fetching schedule for ${date}:`, error);
        return [];
    }
}

// Function to fetch the NFL schedule for the date range and output as JSON
async function getSchedule(year, week) {
    try {
        const { start, end } = getWeekDateRange(year, week);
        const dates = eachDayOfInterval({ start, end });

        const allEvents = [];

        for (const date of dates) {
            const events = await fetchScheduleForDate(date);
            allEvents.push(...events);
        }

        // Build the JSON output with game IDs, names, and dates
        const games = allEvents.map(event => {
            const { id, name, shortName, date: eventDate } = event;
            const eventTimeUtc = parseISO(eventDate);
            const eventTimeCt = toZonedTime(eventTimeUtc, timeZone);

            return {
                id, // Include game ID
                game: name,
                shortName,
                dateTime: `${formatInTimeZone(eventTimeCt, timeZone, 'eeee, MMM d, yyyy @ h:mm a')} CT`,
            };
        });

        // Write the JSON output to a file
        const fileName = `week${week}Schedule.json`;
        const jsonOutput = JSON.stringify({ games }, null, 2);
        fs.writeFileSync(fileName, jsonOutput, 'utf8');
        console.log(`Output:\n${JSON.stringify({ games }, null, 2)}`);
        console.log(`Schedule saved to ${fileName}`);
    } catch (error) {
        console.error('Error fetching schedule:', error);
    }
}

// Example usage
const year = 2024; // You can change this to the desired year
const week = 2;    // You can change this to the desired week number

getSchedule(year, week);
