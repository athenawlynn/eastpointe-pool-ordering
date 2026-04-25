
# Country Club Poolside QR Ordering MVP

This is a Netlify-ready MVP for a private country club pool ordering system.

## What it does

- Members scan a table-specific QR code.
- URL format: `/order?table=37`
- Table number auto-fills from the QR link, but can be edited.
- Members choose **Pickup** or **Delivery** at the beginning of the flow.
- Members enter name, phone, and mandatory 4–6 digit member number.
- Member number is checked against a simple `Members` tab before the order is accepted. The system only validates that the number exists and is marked `Active`.
- Members select food, kids menu, beer/wine/non-alcoholic, and featured cocktails.
- Spirits/cocktails can be entered in a free-text **Bar / Cocktail Request** field.
- No credit-card processing.
- Staff manually charges the member account in the existing club POS.
- Staff receives orders in a browser dashboard at `/admin`.
- Staff can mark an order **Ready for Pickup**, which can trigger an optional SMS text to the member through Twilio.
- Orders are written to Google Sheets.
- Apps Script emails the pool bar as a backup.

## Tech stack

- React + Vite
- Hosted on Netlify
- Google Sheets for menu/orders/settings
- Google Apps Script as backend

## Files

- `src/App.jsx` — member ordering page and staff dashboard
- `src/styles.css` — styling
- `apps-script/Code.gs` — Google Apps Script backend
- `google-sheets/MenuItems.csv` — starter menu based on uploaded menus
- `google-sheets/Orders_headers.csv` — Orders tab headers
- `google-sheets/Settings.csv` — Settings tab starter data
- `.env.example` — environment variables

## Google Sheet setup

Create a new Google Sheet with 4 tabs:

1. `MenuItems`
2. `Orders`
3. `Settings`
4. `Members`

Import or paste the CSV files in `google-sheets/` into the corresponding tabs. The included `Members.csv` has 25 fake test member numbers.

### Required MenuItems columns

`ItemID, Category, ItemName, Description, Price, Available, Alcoholic, SortOrder`

### Required Orders columns

`Timestamp, OrderID, Status, FulfillmentType, MemberName, MemberNumber, Phone, TableNumber, ItemsSummary, ItemsJSON, BarRequest, SubtotalKnownItems, HasCustomBarRequest, AlcoholIncluded, AuthorizationAccepted, AlcoholVerificationAccepted, StaffNotes, UpdatedAt, CompletedAt, ReadyTextSentAt`

### Required Settings columns

`SettingKey, SettingValue`

Important settings:
- `ClubName`
- `PickupLocation`
- `StaffEmail`
- `MaxTableNumber`


### Required Members columns

`MemberNumber, Status`

The MVP uses simple validation only:

- The submitted member number must be 4–6 digits.
- The member number must exist in the `Members` tab.
- The member number must have `Status` set to `Active`.

The member's typed name is collected for the bar ticket, but it is **not** checked against the member database.

The included test members include:
- `1001`
- `1002`
- `1003`
- `11225`
- `11890`
- `12456`
- and additional fake 4–5 digit numbers in `Members.csv`

For real use, replace the fake member list with the club’s approved member-number list.


## Apps Script setup

1. In the Google Sheet, go to **Extensions > Apps Script**.
2. Paste the contents of `apps-script/Code.gs`.
3. Replace:
   - `PASTE_GOOGLE_SHEET_ID_HERE` with your Google Sheet ID.
   - `CHANGE_ME_ADMIN_KEY` with a private admin key.
   - `athenawlynn@gmail.com` with the real staff email.
4. Click **Deploy > New deployment**.
5. Select **Web app**.
6. Execute as: **Me**.
7. Who has access: **Anyone**.
8. Copy the Web App URL.

## Netlify setup

1. Upload/deploy this project folder to Netlify.
2. Add environment variables:
   - `VITE_SCRIPT_URL` = your deployed Apps Script Web App URL
   - `VITE_ADMIN_PASSWORD` = staff dashboard password
   - `VITE_ADMIN_KEY` = same admin key used in Apps Script
3. Deploy.

## Table QR code URLs

Create QR codes for:

- `https://your-site.netlify.app/order?table=1`
- `https://your-site.netlify.app/order?table=2`
- ...
- `https://your-site.netlify.app/order?table=100`

## Staff dashboard

Open:

`https://your-site.netlify.app/admin`

The dashboard:
- Auto-refreshes every 8 seconds
- Shows New / Accepted / Preparing / Ready / Completed / Cancelled
- Flags alcohol orders
- Shows Bar / Cocktail Request separately
- Has print-ticket button

## Notes and MVP limitations

- The staff dashboard password is simple front-end protection for the pilot.
- The Apps Script admin key is used for status updates and order reads.
- This MVP does not validate real member numbers against a member database.
- This MVP does not integrate with the club POS; staff manually posts charges.
- Custom bar requests are not priced in the app.
- For high-volume production, consider Supabase/Firebase or POS integration later.

## Optional later upgrade: ready-for-pickup SMS texting

The app collects the member's mobile number for staff contact. The primary MVP notification is the live order-status screen. To add actual SMS later when staff marks an order **Ready for Pickup**, connect Twilio.

### Twilio setup

1. Create a Twilio account and purchase/verify a sending phone number.
2. In Apps Script, go to **Project Settings > Script Properties**.
3. Add these properties:
   - `TWILIO_ACCOUNT_SID`
   - `TWILIO_AUTH_TOKEN`
   - `TWILIO_FROM_NUMBER`
4. In the `Settings` sheet, set:
   - `SendReadyTexts` = `TRUE`
   - `ReadyTextMessage` = your message template

Supported message placeholders:
- `{{ORDER_ID}}`
- `{{MEMBER_NAME}}`
- `{{TABLE_NUMBER}}`
- `{{PICKUP_LOCATION}}`

Example:

`Eastpointe Country Club: Your pool order #{{ORDER_ID}} is ready for pickup at {{PICKUP_LOCATION}}. Please provide your name/member number at pickup.`

If Twilio is not configured or `SendReadyTexts` is `FALSE`, the system still works normally; it just will not send text messages.

## Pickup vs. delivery flow

At the beginning of the order, the member chooses:

1. **Pickup** — order is picked up at the Pool Bar.
2. **Delivery** — staff delivers to the table number entered by the member.

Delivery requires a table number between 1 and 100. Pickup can still retain the QR-prefilled table number for context, but it is not required.

After submitting, the confirmation screen becomes a live status page. It checks status every 8 seconds and updates when staff marks the order **Ready for Pickup**.

## Design / branding

The MVP includes the Eastpointe Country Club logo as:

`public/eastpointe-logo.png`

The interface uses a restrained country-club palette inspired by the logo:
- Eastpointe green
- Club blue
- Warm cream/paper backgrounds
- Soft gold accent
- Rounded cards and large mobile buttons

The goal is to feel simple, polished, and club-appropriate rather than like a generic restaurant app.
