# Berlinovo Apartment Helper

A Tampermonkey userscript that enhances the Berlinovo apartment search page with apartment details, working action buttons, applied markers, customizable information, and scrollable details.

## Features

* Shows apartment details directly on the search results page.
* Displays monthly rent, cleaning fee, area, rooms, occupancy, and address.
* Optional description, services, and distances.
* Scrollable apartment details to keep the page compact.
* **Open apartment** button.
* **Rental inquiry** button.
* **Mark as Applied** button.
* Remembers applied apartments.
* Option to hide apartments already marked as applied.
* Settings panel to choose which information is displayed.
* **Show all** and **Compact** display presets.
* Refresh apartment details manually.
* Automatically detects dynamically loaded apartments.
* Caches apartment details for faster loading.
* Shows the number of apartments and applied listings.

The script runs on the Berlinovo English apartment search page.

## Installation

1. Install **Tampermonkey**.
2. Create a new userscript.
3. Replace the default content with the `.user.js` file.
4. Save the script.
5. Open the Berlinovo apartment search page.

The userscript automatically starts when the supported page is opened.

## Usage

After installation, a toolbar appears in the top-right corner.

### ⚙ Settings

Choose which apartment information should be displayed:

* Monthly rent
* Cleaning fee
* Area
* Rooms
* Maximum occupancy
* Address
* Description
* Services
* Distances

Your settings are saved automatically in the browser.

### Hide applied

Hides apartments that you have already marked as applied.

Click again to show them.

### Refresh details

Clears the cached apartment information and loads the latest details again.

### Clear marks

Removes all saved **Applied** markers.

## Apartment Actions

Each apartment can have these actions:

**Open apartment**
Opens the original Berlinovo apartment page.

**Rental inquiry**
Opens the rental inquiry/application page when available.

**Mark as Applied**
Marks the apartment as applied and remembers it for future visits.

## Compact Mode

The **Compact** preset keeps only the most useful information:

* Monthly rent
* Area
* Rooms

Everything else is hidden.

## Show All

The **Show All** preset enables all available information fields.

## Caching

Apartment details are cached temporarily to avoid repeatedly requesting the same apartment pages.

The cache expires after **30 minutes**.

## Important

This is a browser userscript that modifies the Berlinovo apartment search interface.

Apartment availability and information come from the Berlinovo website. Always verify important information on the original apartment page before submitting a rental inquiry.
`
## License
MIT
