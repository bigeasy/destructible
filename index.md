Look at the [Docco](./docco/) for now.

## On Breaking Things

I've chased a problem to a crossroads. The problem is how to propagate errors
from parallel asynchronous stacks. You may have two separate streams that you
need to monitor for events, for example. You might spawn a child process and
listen to it's standard out. Waiting for messages on standard out is separate
from waiting for exit.

Cadence doesn't have a timeout. When you create parallel sub-cadences, the
function will not return until both Cadences complete.

```
cadence(function (async) {
    async(function () {
        var loop = async(function () {
            input.get(async())
        }, function (value) {
            if (value == null) {
                return [ loop.break ]
            }
            consumer.consume(value, async())
        })()
    })
    async(function () {
        input.closed(async())
    })
})(abend)
```

In our program, we want to wait for input close because it may report an error
to us. We also want to get things from input, which may also error, our little
pump loop may error.

If input gives us a closed event we would expect get to error. If get errors we
would expect to have input close. This is what we gleaned from reading the
documenation for the `input` class.

We need a mechanism that will timeout the function with an error if the loop
exits but closed is never called or if closed is called but the loop never
exits.

There is no good way for cadence to know how long something is supposed to run.
There is no good assumption as to how long something is supposed to run relative
to something else. There are no assumptions

```
cadence(function (async) {
    var deststuctiable = new Destructible('pump')
    deststuctiable.monitor('loop', this, cadence(function (async) {
        var loop = async(function () {
            input.get(async())
        }, function (value) {
            if (value == null) {
                return [ loop.break ]
            }
            consumer.consume(value, async())
        })()
    }))
    deststuctiable.monitor('loop', this, cadence(function (async) {
        input.closed(async())
    }))
    deststuctiable.completed(10000, async())
})(function (error, closed) {
    if (error) throw error
    console.log('closed with status: ' + closed)
})
```

I don't like that I'm about to repeat an implementation of the ordered results
in Cadence in Destructible, but it does make Destructible not so Cadence
specific. The alternative is Cadence-aware.

```
cadence(function (async) {
    var deststuctiable = new Destructible('pump')
    deststuctiable.completed(10000, async())
    deststuctiable.monitor(async, 'loop')(function () {
        var loop = async(function () {
            input.get(async())
        }, function (value) {
            if (value == null) {
                return [ loop.break ]
            }
            consumer.consume(value, async())
        })()
    })
    deststuctiable.monitor(async, 'loop')(function () {
        input.closed(async())
    })
})(function (error, closed) {
    if (error) throw error
    console.log('closed with status: ' + closed)
})
```

The above requires a modification to Cadence where Cadence does not return the
first error it catches but instead returns the errors in the order in which they
are declared so that if there is a hang up, the wrapped exception gets reported.

The problem with this one is that if there is a hangup, there is still now way
to stop the nested Cadences. It won't return. This could be expressed as such.

```
cadence(function (async) {
    var deststuctiable = new Destructible('pump')
    deststuctiable.monitor(async, 'loop')(function () {
        var loop = async(function () {
            input.get(async())
        }, function (value) {
            if (value == null) {
                return [ loop.break ]
            }
            consumer.consume(value, async())
        })()
    })
    deststuctiable.monitor(async, 'loop')(function () {
        input.closed(async())
    })
    deststuctiable.timeout(10000)
})(function (error, closed) {
    if (error) throw error
    console.log('closed with status: ' + closed)
})
```

Here the timeout is catastrophic. It would cause an exception to be raised that
cannot be caught. It ends up being similar to our terminator class, but built
in. With this we surrender the notion of funneling exceptions upward and maybe
we should because...

A stuck stack is catastrophic. You can wait for it to finish, but maybe it is
going to be a while, like maybe forever.

You've given a callack to ??? and it is not getting called back. You either wait
or if you timeout you now have to deal with a leak.

A leak!

OR

You're dealing with a callback that will be called eventually. When that happens
what do you do with the result? You've timed out, moved on. You reported an
error to your callee. No one is listening. No one to return to.

And what if you're callback receives an error? At that point you abend.

Thus, the only reasonable result is to abend.

```
cadence(function (async) {
    var deststuctiable = new Destructible('pump')
    deststuctiable.monitor('loop', this, cadence(function (async) {
        var loop = async(function () {
            input.get(async())
        }, function (value) {
            if (value == null) {
                return [ loop.break ]
            }
            consumer.consume(value, async())
        })()
    }))
    deststuctiable.monitor(async, 'loop')(function () {
        input.closed(async())
    })
    deststuctiable.timeout(10000)
})(function (error, closed) {
    if (error) throw error
    console.log('closed with status: ' + closed)
})
```

That is the easy-for-me Cadence way.

```
cadence(function (async) {
    var deststuctiable = new Destructible('pump')
    deststuctiable.monitor('loop', this, cadence(function (async) {
        var loop = async(function () {
            input.get(async())
        }, function (value) {
            if (value == null) {
                return [ loop.break ]
            }
            consumer.consume(value, async())
        })()
    }))
    deststuctiable.monitor('loop', function (callback) {
        input.closed(callback)
    })
    deststuctiable.timeout(10000, async())
})(function (error, closed) {
    if (error) throw error
    console.log('closed with status: ' + closed)
})
```

Could we just build this into Cadence?

```
cadence(function (async) {
    async.shutdown(1000)
    async(function () {
        var loop = async(function () {
            input.get(async())
        }, function (value) {
            if (value == null) {
                return [ loop.break ]
            }
            consumer.consume(value, async())
        })()
    })
    async(function () {
        input.closed(async())
    })
})(abend)
```

Because it is such a sticking point. It is the bit left out. Destructible still
has the destructors, though.

```
cadence(function (async) {
    async.shutdown(1000)
    async(function () {
        async.loop(function () {
            input.get(async())
        }, function (value) {
            if (value == null) {
                return [ async.break ]
            }
            consumer.consume(value, async())
        })
    })
    async(function () {
        input.closed(async())
    })
})(abend)
```

Don't get so melodramatic about the missed callbacks. You could also miss them
if you raise an exception after creating a callback.

**MAYBE**: The only way to do this is to preserve the boundary.

Thus, destructor generates callbacks. It does preserve the results and return
them. This ends up duplicated Cadence a bit. Not sure how you would go about
implementing Rescue. Ah, with a callback, too.

Because the wrapping appears to be no end of trouble as far as propagation goes,
and the special activities with someone else's `async` are way to tricky.

 * Implies that this is some sort of inside-out Cadence, which makes you want to
 seek a Cadence decorator.
 * Removes the nice and clean implementations you imagined, using closures, but
 it ought to be easier to see what is going on.
 * Always wait for completed, gather your results there, or else get your error.

Wrapping is causing a lot of architecture to appear, so before you walk away
from wrapping, you're going to want to know why it didn't work.

 * What did wrapping add to complexity to cause Cadence to catch use exceptions?
 * What would it take to make that go away?
 * Is there a way to do the `async` trick generally, and not bake it into
 libraries specifically?
 * The use of `async` trick in Compassion is fooling you in Destructible.
 * Can I remove `monitor` without affecting Staccato?

The problem is in calling unwind and that, in turn, calling the completion
Signal, which resumes running before everything is really wound down.

Why? This means that arbitrary callbacks are being fired. The destructors. These
are generally causing other stacks to unwind, so that is not going to often be
an issue. But when the last one unwinds it triggers continued action.

Thus, we call this completed function and resume from within a destructor that
has it's own callback that will catch an error thrown from the resumed code.
We're invoking from within Cadence.

We could use nextTick, but we haven't yet. All this would change if we embraced
it.

Destructable becomes some sort of countdown latch, then. Doesn't really require
a deep rethink of Cadence.

Your program will exit because there is no work in the event loop, but you're
stack trace does not appear because something didn't completely wind down.
