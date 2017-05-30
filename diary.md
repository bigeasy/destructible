## Mon Apr 10 16:07:41 CDT 2017

Unlike `EventEmitter`, there seems to be only two uses for `Signal` such that
`Signal` has not come to duplicate `EventEmitter`.

You are either waiting for something to become ready or you are waiting for
something to exit.

With Arguable you frist experienced this. Does the body of Arguable run to
completion or does it return after having processed arguments and started
threads. Untimately we decided on the latter. It's what I'd come to expect. It
fits the expectations of that area of a Node.js program. For small scripts, it
would be nice to have the body run to completion (using Cadence for logic) and
return a value, but many applications are starting servers, starting
asynchrnous stacks, work queues, message queues, etc.

With Arguable we decided to return immediately, then use events. There is no
real way to get a notion that the program has exited if you're not actually
running the program, no notion in testing. This might not be the best way to go,
but it is where we are.

So there is no exit signal from Arguable.

And then when used in other contexts, as an argument parser alone, Arguable will
return a structure or whatever is needed.

Destructible however, does define how you run to completion. Maybe if I feel
really good about Destructible, I'll change the behavior of Arugable.

Essentially a queue of things to start. And `ready` is going to be ready when
the last thing to start starts.

This was not a very useful diary entry. Or at least, it doesn't seem very
profound. If you find this useful at some point make a note of that.

Also, my words no good now.
