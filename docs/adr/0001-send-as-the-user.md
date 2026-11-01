# Send as the user's account, not a bot

Glider logs in to the user's own Telegram account (MTProto, through mtcute) and sends links as the user. A bot cannot write to a friend, to another bot, or to Saved Messages, and those are the chats the user wants. The saved session has full access to the account, and Telegram watches accounts that log in through unofficial apps. One message per click and the send limit keep that risk low.
