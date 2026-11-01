# Undo means wait, then send

A send waits 5 seconds inside the extension before any request goes to Telegram. We did not send at once and delete on Undo, because the other person could already have seen the message or its notification.
