## Sat Aug 24 14:14:05 CDT 2019

Otherwise you get an unhandled rejection. That will have a stack trace,
sometimes, and that's nice, but in those cases where the stack trace is
truncated, as in a response to a socket becoming ready to read, you're not
likely to know where in your code this track trace arises.

You'll at least known the strand in which it arose with `Destructible` and that
is often more than enough to know where to look, since each strand tends to deal
with one asynchronous object.

## Wed Dec 19 15:35:26 CST 2018

Diary procedure is to re-read your diary when you return to the project. When
you return and you have to spend a lot of time with the diary, take the
opportunity to summarize your reload. You can save yourself time by re-reading a
diary. See your Prolific diary around this time for a tale of project re-entry
woe.

## Wed Dec 19 15:32:23 CST 2018

Going to remove `Destructible.destroy(error)`. It's no good. Why when it is just
as easy to `Destructible.durable('name')(error)`?
