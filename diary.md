## Sat Sep  5 04:23:06 CDT 2020

Shutting things down is hard. Convinced that > 90% of Node.js code in production
is shutdown with `kill -9`. Even when trying to organize code so that it is
`async`/`await` and therefore linear in its logic, there are so many race
conditions at shutdown when you have many different concurrent and dependent
strands.

Destructible encourages concurrent and dependent stands, breaking work up into
its own linear function, like a thread. I find it relatively easy to reason
about how to do this sort of concurrent programming in the Node.js single-thread
model. Shut down time is when things break down.

Shut down should be as synchronous as possible.

## Sat Sep  5 03:33:42 CDT 2020

Although it would be a mess to document, maybe we accept new work right up until
we've really and truly shutdown.

## Sat Sep  5 01:50:56 CDT 2020

Still not right. I've made it now so that you're no able to start new
ephemeral strands when a `Destructible` is in a destroyed state. The
`Destructible` will raise an excpetion if you do. I went and reworked Turnstile
to use `durable` so it could keep chugging along until the queue was empty.

Now I'm in Amalgamate, which has a queue, and that queue is supposed to go into
a Strata. If they are part of the same `Destructible` tree then the Strata
b-tree's `Destructble` will get `destroyed` and it will no longer accept reads
wor writes, but the Amalgamate queue, that's all it does. Definately want to
finish the work we where doing, or at the very least we do not want to check
destroyed prior to each write. We could just let the exception get raised and
revisit when we reopen.

So, we could create a `Destructible` that is not part of the tree and destroy
our Strata databases when we're ready, or we could add some feature to a child
destructible that creates some sort of countdown to marking as destroyed, maybe
assume that all shutdowns involve a queue, so you may have a flag that says we
are shutting down, so perhaps the queue starts making notes about its work to
resume on restart, and one that actually prevents pushing onto the queue.

I do want the exceptions to raise only when there is an orderly shutdown, I
don't think. Once we are destroyed, however, we are in state where new
ephemerals could be missed, arriving after `destructed` has been set, which was
the case with Strata which pushed more housekeeping work onto a Turnstile, the
Turnstile created a new ephemeral and that ephemeral was ignored.

We still want the scram chain, don't we? We just want the ability to keep
launching ephemerals, so perhaps it is a question of increment and decrement.
Could we create a child Destructible, use increment and decrement to destroy the
child and allow the user to also increment and decrement to stay destroy? This
means that a Destructable could get a scram when it is not in a destroyed state,
which I don't believe I've accounted for in any way.

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
