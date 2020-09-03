## Wed Sep  2 06:26:58 CDT 2020

Trying to shutdown a database. Want to use Destructible's mechanics to do so,
but they are not fit for purpose. I do want to timeout a shutdown, but not if
the shutdown is making progress. Say the database is in the middle of an
operation and we're trying to do a soft shutdown. Programs crash, it's true, and
we could give it an amount of time, and the user could adjust that time, but if
the database is chugging along, saving files, indexing employee ids and the
like, then why bother?

Wouldn't it be nice to push some more time onto the scram clock so that the
database can ask for a few more seconds if it is onto another page?

At the same time, shutdown is something that you want to have happen, so maybe
applications should try to shutdown as quickly as possible, recoring what it had
hoped to do, then doing that when it starts up again, especially this database
where these actions are background actions. They could run in a future
background.

In this specific example, we do not want to shut down before we finish writing
pages to file, but if we need to rebalance the tree or vacuum pages, that can
wait for a future background.

## Sun Oct  6 01:51:50 CDT 2019

Having added `scrammable` as a final argument to the destructible construction
functions I now see that what I wanted to accomplish, a destructible that will
not fire destructors when destruct is called can be accomplished by not
registering any constructors. This is no more or less fiddly that introducing
the concept of a scrammable promise. Now I want to remove this exposure and
return scrammable to an internal property.

See #146.

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
