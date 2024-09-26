# Pool Parlay

## Scripts
These should be run from the `./scripts/` directory
### Updating Schedule
This script will update `./season_data.json` with the schedule for the selected week.
1. `node updateSchedule <WEEK_NUM>`

### Updating Scores
This script will update `./season_data.json` with the scores for the selected time range.
1. Update the month/date:
```javascript
// Define the date range (e.g., starting Thursday, Sept. 5, 2024, to Sept. 19, 2024)
const startDate = new Date(2024, 8, 5); // September 5, 2024
const endDate = new Date(2024, 8, 19);   // September 19, 2024
```
2. `node updateScores`

### Creating Google Form
This script will create the Google Form for the given week.
*Note: You must already have the week in `season_data.json`*. Keep an eye on where you're storing
Google Auth credentials. Make sure they are not committed to source control.
1. `node createForm <WEEK_NUM>`