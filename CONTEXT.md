# Glider

A Chrome extension that sends the current page's link to one Telegram chat from the user's own account, with a 5-second undo.

## Language

**Session**:
The saved Telegram login of the user's own account.
_Avoid_: token, auth

**App key**:
The api_id and api_hash pair from my.telegram.org that identifies Glider to Telegram.
_Avoid_: API key, bot token

**Target chat**:
The one Telegram chat that gets every link. It belongs to the account that saved it; another account has none until it picks one.
_Avoid_: destination, recipient

**Send**:
One click on the toolbar icon, or ⌘⇧S, that starts sending the current page's link to the target chat.
_Avoid_: share, post

**Waiting link**:
A link inside its undo window. Nothing has left the browser yet.
_Avoid_: pending, queued, draft

**Undo window**:
The 5 seconds between a send and the request to Telegram.
_Avoid_: delay, grace period

**Send limit**:
At most 10 sends per minute.
_Avoid_: throttle

**Failed link**:
A link that did not reach Telegram. It stays in the popup with Retry and Remove until the user acts.
_Avoid_: error, returned
