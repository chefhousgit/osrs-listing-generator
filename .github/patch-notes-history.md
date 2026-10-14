## April 19, 2026 · First version
- Upload account screenshots and get an Eldorado-style title and description
- Account name lookup on the official hiscores for exact skill levels
- Zoomed-in reading of small numbers so levels and totals are read correctly
- Numbers are reported exactly or left out, no more made-up "+" or rounded-up stats
- Fractions like 21/1699 are no longer misread as one big number
- Skill emojis in titles and descriptions
- Gear checklist to confirm items the account really has
- Fixed clean-account and login-method footer on every description

## April 25, 2026 · Editing and launch helpers
- Description is editable before copying
- Separate emoji on/off switches for the title and the description
- Star an item in the gear checklist to force it into the title
- start.bat to launch the app and update.bat to update it
- Emojis are always fully removed when switched off

## September 2026 · Account type, login method and skill redaction
- Newer, sharper AI model for reading screenshots
- Account type picker (Auto, Main, Ironman, HCIM, UIM) and login method picker
- Skill redaction tool: black out skills on a stats screenshot before generating
- Descriptions shortened to one clear sentence
- Save button for images; Sailing added to the skills grid

## October 2, 2026 · Listing card and handover message
- Build listing card: one framed image with the afkVault logo, tags and watermark
- Buyer handover message you can copy after a sale
- Ban history picker: the clean-account line only shows for accounts with no bans
- Jagex Launcher is the default login method
- Same fixed description sentence for every listing, per account type

## October 11, 2026 · Publish straight to Eldorado
- Publish to Eldorado from the app: the offer is created and paused for you to check
- Every Eldorado field filled in for you: type, combat, total level, quest points, pets, login method
- The listing card is built and uploaded as the main image automatically
- The bank screenshot is uploaded as the second image
- Account type detected from the hiscores (dead HCIM counts as Ironman)
- The publish panel opens right after Generate, no extra window

## October 11, 2026 · Account folders and the queue
- Pick accounts from your accounts folder: screenshots, name, type, ban history and login load in one go
- Folder tags: "- hc", "- uim", "- im", "- main", "- temp"
- Login, password and 2FA key read from the .txt in each account folder (EternalFarms exports work as-is)
- Queue several accounts: redact one while the previous one generates
- Progress bar: "Account 3 of 10", with a status for each account
- Only redacted screenshots can go on the listing card; "Already redacted" for ones you blacked out yourself
- Card title shows the total level and type, e.g. "1007 Total Level HCIM"
- Listed accounts move to a Listed folder you choose
- Search box in the account menu

## October 12, 2026 · Discord alerts
- #listed: every new offer with its listing card
- #sales: new sales, cancellations and completed orders, 24/7
- #disputes: disputes with an @here ping
- #summary: daily recap at 7pm (listed, sold, revenue, stock, stale listings)
- #errors: publish problems and Eldorado credential problems
- The listing card no longer shows a price, since prices change on Eldorado

## October 14, 2026 · Fixes
- Fewer requests to Eldorado, so no more overnight "Quota exceeded" errors
- Patch notes like these now show up in Discord whenever the app is updated
