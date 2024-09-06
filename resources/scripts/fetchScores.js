import fs from 'fs';
import fetch from 'node-fetch';
import { format } from 'date-fns';

function getFormattedDate(date = new Date()) {
    return format(date, 'yyyyMMdd');
}

async function fetchScores(date) {
    try {
        const formattedDate = date || getFormattedDate();
        const endpoint = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=${formattedDate}`;
        const response = await fetch(endpoint);
        const data = await response.json();
        const games = data.events;

        if (!games || games.length === 0) {
            console.log('No games found for the given date.');
            return;
        }

        const completedGames = games.filter(game => game.status.type.name === 'STATUS_FINAL');

        const result = completedGames.map(game => {
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

        let output = JSON.stringify(result, null, 2);
        console.log(output);
        fs.writeFileSync('completedGames.json', output);
        console.log('Completed games data has been written to completedGames.json');

    } catch (error) {
        console.error('Error fetching scores:', error);
    }
}

const args = process.argv.slice(2);
const date = args[0] ? args[0] : null;

fetchScores(date);
