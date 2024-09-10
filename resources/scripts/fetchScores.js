import fs from 'fs';
import fetch from 'node-fetch';
import { format, addDays } from 'date-fns';

// Define the date range for Week 1 (starting Thursday, Sept. 5, 2024)
const startDate = new Date(2024, 8, 5); // September 5, 2024
const endDate = new Date(2024, 8, 9);   // September 9, 2024

function getFormattedDate(date) {
    return format(date, 'yyyyMMdd');
}

async function fetchScoresForDate(date) {
    const formattedDate = getFormattedDate(date);
    const endpoint = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=${formattedDate}`;
    const response = await fetch(endpoint);
    const data = await response.json();
    return data.events;
}

async function fetchScoresForWeek() {
    try {
        let currentDate = startDate;
        let allCompletedGames = [];

        // Loop through each day in the date range
        while (currentDate <= endDate) {
            const games = await fetchScoresForDate(currentDate);
            const completedGames = games.filter(game => game.status.type.name === 'STATUS_FINAL');

            const dailyResults = completedGames.map(game => {
                const homeTeam = game.competitions[0].competitors[0].team.displayName;
                const awayTeam = game.competitions[0].competitors[1].team.displayName;
                const homeScore = game.competitions[0].competitors[0].score;
                const awayScore = game.competitions[0].competitors[1].score;

                return {
                    homeTeam,
                    awayTeam,
                    homeScore,
                    awayScore,
                    status: 'Completed'
                };
            });

            allCompletedGames = allCompletedGames.concat(dailyResults);
            currentDate = addDays(currentDate, 1);  // Move to the next day
        }

        if (allCompletedGames.length === 0) {
            console.log('No games found for the given week.');
            return;
        }

        let output = JSON.stringify(allCompletedGames, null, 2);
        console.log(output);
        fs.writeFileSync('completedGames.json', output);
        console.log('Completed games data has been written to completedGames.json');

    } catch (error) {
        console.error('Error fetching scores:', error);
    }
}

fetchScoresForWeek();
