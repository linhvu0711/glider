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
