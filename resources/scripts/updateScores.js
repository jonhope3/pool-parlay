import fs from 'fs';
import fetch from 'node-fetch';
import { format, eachDayOfInterval } from 'date-fns';

// Define the date range (e.g., starting Thursday, Sept. 5, 2024, to Sept. 19, 2024)
const startDate = new Date(2024, 8, 5); // September 5, 2024
const endDate = new Date(2024, 8, 19);   // September 19, 2024

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

async function fetchScoresForDateRange(startDate, endDate) {
    try {
        let allCompletedGames = [];
        const dates = eachDayOfInterval({ start: startDate, end: endDate });

        for (const date of dates) {
            const games = await fetchScoresForDate(date);
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
        }

        return allCompletedGames;
    } catch (error) {
        console.error('Error fetching scores:', error);
        return [];
    }
}

async function updateSeasonData() {
    try {
        const allCompletedGames = await fetchScoresForDateRange(startDate, endDate);

        if (allCompletedGames.length === 0) {
            console.log('No games found for the given range.');
            return;
        }

        // Load the existing season data
        const seasonData = JSON.parse(fs.readFileSync('../season_data.json', 'utf-8'));

        // Update the games with completed scores
        seasonData.weeks.forEach(week => {
            week.games.forEach(game => {
                // Ensure homeTeam and awayTeam exist
                if (game.homeTeam && game.awayTeam && game.homeTeam.fullName && game.awayTeam.fullName) {
                    const completedGame = allCompletedGames.find(
                        completed => completed.homeTeam === game.homeTeam.fullName &&
                            completed.awayTeam === game.awayTeam.fullName
                    );

                    if (completedGame) {
                        const winningTeam = completedGame.homeScore > completedGame.awayScore
                            ? game.homeTeam.fullName
                            : game.awayTeam.fullName;

                        // Check if consensus is not empty before updating the outcome
                        if (game.consensus) {
                            if (winningTeam === game.consensus) {
                                game.outcome = 'W';  // Consensus team won
                            } else {
                                game.outcome = 'L';  // Consensus team lost
                            }
                        }
                    }
                } else {
                    console.error('Missing team data:', game);  // Log missing data
                }
            });
        });


        // Save the updated data back to the file
        fs.writeFileSync('../season_data.json', JSON.stringify(seasonData, null, 2));
        console.log('Season data has been updated and written to season_data.json');
    } catch (error) {
        console.error('Error updating season data:', error);
    }
}

updateSeasonData();
