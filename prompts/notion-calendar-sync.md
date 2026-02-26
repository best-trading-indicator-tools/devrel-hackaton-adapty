# Notion Calendar Sync

## Automated sync (GitHub Actions)

The workflow `.github/workflows/notion-calendar-sync.yml` runs every 6 hours and on manual trigger. Add `NOTION_API_KEY` to repo Secrets (from notion.so/my-integrations; share SMM PLANNING with the integration). Run locally: `npm run notion-sync`.

## Manual sync (via MCP)

When the user asks to sync the Notion calendar:

1. Fetch the SMM PLANNING database: `https://www.notion.so/Corporate-X-LinkedIn-2851ca4355c3801499faff0bb770b9b9` (or the data source `collection://2851ca43-55c3-81d0-a585-000bd290877f`)
2. Use `notion-search` with `data_source_url: "collection://2851ca43-55c3-81d0-a585-000bd290877f"` to get pages
3. For each planning page: fetch it with `notion-fetch` to get Name, Date, Event relation, Tags, content
4. For each linked Event: fetch with `notion-fetch` to get Event name, date, Region, Time, Owner, Event Type
5. Build JSON matching `NotionCalendarData` in `src/lib/notion-calendar.ts`
6. Write to `data/notion-calendar.json`
7. **Tag specific people for incomplete entries** using the rules below. Use `notion-update-page` to add mentions in the page body. **Only tag upcoming posts** (entry date ≥ today); skip past entries.

## User IDs (fixed)

- Ahmet Burak Ilhan: `user://1f8d872b-594c-8141-9a7f-00023792fa71`
- Julia Averkina: `user://5ac0c36e-9df9-4fc6-a067-f42a71e42cca`
- David Attias: `user://2f4d872b-594c-814d-8b4d-00023eb7a155`

## Tagging rules

| Condition | Tag |
|-----------|-----|
| **Article promo** + no link (event?.eventPage empty, no URL in content) | @Ahmet Burak Ilhan |
| **Webinar or offline event** + no visual (content doesn't mention image/photo/visual) | @Julia Averkina |
| **Product update event** + visual missing | @Ahmet Burak Ilhan and @David Attias |

**Detection:**
- Article promo: Name contains "Article" or "article promo" or Tags suggest article
- Webinar/offline event: Event Type is Webinar, Conference, Meetup, Our side event, Dinner/Breakfast, etc.
- Product update: Name contains "product update" or "Product" or Event Type suggests product launch

**authorIdsToTag** (for JSON): Resolve from the rules above. Use these IDs:
- Ahmet: `1f8d872b-594c-8141-9a7f-00023792fa71`
- Julia: `5ac0c36e-9df9-4fc6-a067-f42a71e42cca`
- David: `2f4d872b-594c-814d-8b4d-00023eb7a155`

## How to add the mention

Use `notion-update-page` with:
- `command`: `replace_content` (if page is blank) or `insert_content_after` (if page has content)
- `new_str`: `⚠️ Please provide more details — <mention-user url="user://{userId}"/>` for each user (separate with space or comma). For multiple: `⚠️ Please provide more details — <mention-user url="user://1f8d872b-594c-8141-9a7f-00023792fa71"/> <mention-user url="user://2f4d872b-594c-814d-8b4d-00023eb7a155"/>`
- When no rule matches: add `⚠️ Please provide more details: link an Event, add Tags, and content.` (no mention)

Schema:
- `syncedAt`: ISO string
- `entries`: array of `{ id, notionUrl, name, date, content, event?, tags?, needsAuthorInput, needsEventDetails, authorIdsToTag }`
- `event`: `{ id, name, eventName?, eventType?, eventDate?, eventPage?, region?, time?, ownerIds? }`
