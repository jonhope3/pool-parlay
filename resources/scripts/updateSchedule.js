import axios from 'axios';
import { eachDayOfInterval, parseISO, addDays, nextDay } from 'date-fns';
import { formatInTimeZone, toZonedTime } from 'date-fns-tz';
import fs from 'fs';
import process from "process"; // Import the fs module

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

// Helper function to parse team information including logos
function parseTeam(team) {
    return {
        fullName: team.displayName,
        cityName: team.location,
        teamName: team.name,
        cityShort: team.abbreviation,
        logoUrl: team.logo, // Add the team's logo URL if available
    };
}

// Function to fetch the NFL schedule for the date range and update the JSON file
async function updateSeasonData(year, week) {
    try {
        const { start, end } = getWeekDateRange(year, week);
        const dates = eachDayOfInterval({ start, end });

        const allEvents = [];

        for (const date of dates) {
            const events = await fetchScheduleForDate(date);
            allEvents.push(...events);
        }

        const games = allEvents.map(event => {
            const { date: eventDate, competitions } = event;
            const eventTimeUtc = parseISO(eventDate);
            const eventTimeCt = toZonedTime(eventTimeUtc, timeZone);

            const homeTeamData = competitions[0]?.competitors.find(c => c.homeAway === 'home').team;
            const awayTeamData = competitions[0]?.competitors.find(c => c.homeAway === 'away').team;

            const homeTeam = parseTeam(homeTeamData);
            const awayTeam = parseTeam(awayTeamData);

            return {
                homeTeam,
                awayTeam,
                gameTime: `${formatInTimeZone(eventTimeCt, timeZone, 'eeee, MMM d, yyyy @ h:mm a')} CT`,
                consensus: "", // This will be updated later if needed
                outcome: ""    // This will be updated later if needed
            };
        });

        // Read the existing season data from the file
        const filePath = '../season_data.json';
        const fileData = fs.readFileSync(filePath, 'utf8');
        const seasonData = JSON.parse(fileData);

        // Find the correct week and update it
        const weekData = seasonData.weeks.find(w => w.week === week);
        if (weekData) {
            weekData.games = games;
        } else {
            seasonData.weeks.push({ week, games });
        }

        // Write the updated JSON back to the file
        const jsonOutput = JSON.stringify(seasonData, null, 2);
        fs.writeFileSync(filePath, jsonOutput, 'utf8');
        console.log(`Updated season data saved to ${filePath}`);
    } catch (error) {
        console.error('Error updating season data:', error);
    }
}

// Example usage
const year = 2024; // You can change this to the desired year
const selectedWeek = parseInt(process.argv[2]); // Get the selected week from command line argument

updateSeasonData(year, selectedWeek);
