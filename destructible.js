// Node.js API.
const assert = require('assert')

// Timers wrapped in promises.
const delay = require('delay')

// `async`/`await` utilities.
const Future = require('prospective/future')

// Cancelable evented semaphore.
const Signal = require('signal')

// Exceptions that you can catch by type.
const Interrupt = require('interrupt')

// A helper class that will create a destructor object that will gather items
// that require destruction during an operation, but clear the items if the
// operation successfully completes.

//
class Destructor {
    // Constructor called internally with the parent `Destructible`.
    constructor (destructible) {
        this._destructors = []
        this._destructible = destructible
    }

    // Invoke the given destructor `f` if the parent `Destructible` is
    // destroyed.
    destruct (f) {
        this._destructors.push(this._destructible.destruct(f))
    }

    // Clear all the destructors registered by this `Destructor` instance.
    clear () {
        this._destructors.splice(0).forEach(f => this._destructible.clear(f))
    }
}

// `Destructible` awaits multiple concurrent JavaScript `Promise`s as
// implemented by the JavaScript `Promise` class. Additionally, `Destructible`
// registers destructor functions that will cancel the `Promise`s it is
// awaiting. `Destructible` will allow you to stop all the awaited `Promise`s at
// once and return. Unlike `Promise.all`, `Destructible` will ensure that all
// the promises return when any `Promise` rejects.
//
// TODO Introduce the term "`Promise` group."
//
// When you cancel a `Destructible` it will fire all the destructor functions
// you registered to cancel all the `Promises`s you registered. You can use
// cancellation to ensure that all your `Promise`s resolve when you exit your
// application.
//
// Cancellation can also occur automatically when a `Promise` in the group
// resolves. This is done by registering the `Promise` as a durable `Promise`,
// meaning that it should run for the duration of the `Promise` group. If it
// resolve it means that the `Promise` group has finished it's task and all the
// other `Promises` should resolve shortly.
//
// You await the resolution of the collected `Promise`s in a `Destructible` by
// awaiting the resolution of the `Destructible.promise` property which itself a
// `Promise`. If one or more of the the awaited promises rejects,
// `Destructible.promise` will reject with an `Error` that collects the
// rejections as causes and reports them in a nested heirarchy with their stack
// traces so you can see all the errors that interrupted your application, not
// just the first one raised.
//
// You can group your `Promise`s by a specific application task &mdash; like
// reading and writing to an open socket &mdash; by creating
// sub-`Destructible`s. You can then cancel a sub-`Destructible` without
// cancelling it's parent.
//
// It creates a dependency tree for destructors. A root `Destructible` instance
// can be used to create sub-`Destructible` instances that will destruct when
// the root destructs. sub-`Destructible` instances can create further
// sub-`Destructible` instances and so on.
//
// `async` functions are monitored by passing their `Promise`s to either
// `Destructible.durable()` if the end of the function should indicate the end
// of the program or `Destructible.ephemeral()` if the end of the function
// should not indicate the end of the program. `Destructible.ephemeral()` acts
// as a boundary. Any sub-`Destructible`s that are durable will trigger the
// destruction of the sub-tree that is rooted at the first ancestor that is
// ephemeral or at the top most `Destructible` if none exist.
//
// For example, you can use an ephemeral `Destructible` to monitor an open
// socket and shut down all `async` functions that are participating in the
// processing of that socket. An `async` function may return because it has
// reached the end-of-stream while reading the socket and then trigger the
// shutdown of the writing end of the socket and any other functions
// participating in the processing of the socket input. It will not shutdown any
// other ephemeral trees processing other sockets.
//
// However, in this example, if you destroy the root `Destructible` it will
// trigger the shutdown of all sub-`Destructible`s thereby destroying all the
// ephemeral sub-`Destructible`s that are processing sockets.
//
// To cancel your `async` functions you register destructors using the
// `Destructible.destruct()` function. Destructors are run when you call
// `Destructible.destroy()`.

//
class Destructible {
    // `new Destructible([ scram ], key, ...context)` constructs a new
    // `Destructible` that will scram after the given `scram` timeout or the
    // default `1000` milliseconds if not given. The key is used to report the
    // `Destructible` in the stack trace on error or scram. The `context` is
    // used to provide further context to the error stack trace for debugging.
    constructor (...vargs) {
        this._timeout = typeof vargs[0] == 'number' ? vargs.shift() : 1000
        this.key = vargs.shift()
        this.context = vargs

        this.destroyed = false
        this.waiting = []
        this._scrammable = []

        this._errors = []

        this._destructors = []
        // Yes, we still need `Signal` because `Promise`s are not cancelable.
        this._scram = new Signal
        this._completed = new Future
        this.promise = this._completed.promise

        this._results = {}

        this._scramTimer = null
    }

    // `destructible.destruct(f)` &mdash; Register a destructor `f` that will be
    // called when this `Destructible` is destroyed.

    //
    destruct (f) {
        const destructor = () => f()
        this._destructors.push(destructor)
        return destructor
    }

    // `destructible.destruct(f)` &mdash; Remove the registered destructor `f`
    // from the list of destructors to call when this `Destructible` is
    // destroyed.

    //
    clear (f) {
        const index = this._destructors.indexOf(f)
        if (~index) {
            return this._destructors.splice(index, 1).shift()
        }
        return null
    }

    // `const destructor = destructible.destructor()` &mdash; Create a
    // `Destructor` class that can be used to register a group of destructors
    // and clear them all at once. Great for working with `try`/`finally` blocks
    // &mdash; syntactically easier than creating named functions.

    //
    destructor () {
        return new Destructor(this)
    }

    //

    // Internal method for processing the return value when either all monitored
    // promises have resolved or the shutdown failed to complete before the
    // scram timeout.
    _return () {
        if (this.waiting.length != 0) {
            this._completed.resolve(new Destructible.Error('scrammed', this._errors, {
                key: this.key,
                context: this.context,
                waiting: this.waiting.slice()
            }))
        } else if (this._errors.length != 0) {
            this._completed.resolve(new Destructible.Error('error', this._errors, {
                key: this.key,
                context: this.context,
                waiting: this.waiting.slice()
            }))
        } else {
            this._completed.resolve(null, this._results)
        }
    }

    // This is our internal destroy. We run it as an async function which
    // creates a new strand of execution. Nowhere do we wait on the promise
    // returned by executing this function nor should we. It is fire and forget.
    // Hung or rejected child promises are reported through an `Interrupt`
    // generated error through the `Destructible.promise`.

    //
    async _destroy (context, error) {
        // We're going to say that the first error reported is a root cause of
        // the end of the `Destructible` but I don't see where I'm actually ever
        // using this. TODO Might be better to report an error with the order in
        // which it was reported.
        if (this.cause == null) {
            this.cause = {
                method: 'await',
                ephemeral: context.ephemeral || null,
                key: this.key,
                monitorKey: context.key || null
            }
        }
        // If there is an error, push the error onto the list of errors.
        if (error != null) {
            this._errors.push([ error, { method: 'await', ...context } ])
        }
        // If we've not yet been destroyed, let's start the shutdown.
        if (!this.destroyed) {
            this.destroyed = true
            // Run our destructors.
            while (this._destructors.length != 0) {
                try {
                    await this._destructors.shift().call(null)
                } catch (error) {
                    this._errors.push([ error, { method: 'destruct', key: this.key } ])
                }
            }
            // If we're complete, we can resolve the `Destructible.promise`,
            // otherwise we need to start and wait for the scram timer.
            if (this._complete()) {
                this._return()
            } else {
                // When this was an error-first callback library, scram was
                // synchronous and the chain of scrams implemented as callbacks
                // stored in a Signal object, which we can just imagine is an
                // array of callbacks all waiting for a common response. Here
                // we'd add ourselves to the end of our own array of callbacks
                // knowing that all our children will get the scram before we
                // do. When a child reports a scrammed exception on a waiting
                // callback, the parent of that child get that exception as a
                // resolution of the child &mdash; instead of reporting the
                // child as waiting, it will report an error, the cause of that
                // error will be the child's scram exception.
                //
                // Now that we're using Promises we can't just fire scram and
                // expect all children to either raise scram exception or
                // propagate a scram exception because the destroy operations
                // waiting on the child's resolution will not execute until the
                // next tick. Now we need to wake from our scram timer or else
                // wake from waiting on the expired message to and then wait
                // again for the parents of our grand children to respond to the
                // resolution of their children's promises.
                //
                // For a moment there, we where using the event-loop order to
                // resolve this. Because the order is next tick, promises,
                // immediate, if we wait on a promise we're just going to have
                // everyone hop in a queue and hop out again in the same order
                // before resolving their promises. When we wait on immediate we
                // create a new queue where we run in the same order, so that
                // our greatest grand child will resolve its promise, then its
                // parent will run later. In the mean time, the child's promise
                // will invoke the destroy logic because promises precede
                // immediates.
                //
                // And then there was a need to have more than one immediate
                // after to the root timer. I wasn't certain if two did the
                // trick or if the number of immediates needed was dependent on
                // the depth of the sub-destructible tree. I didn't take bother
                // to take the time to reason about it. The event-loop trickery
                // was too opaque and I'd already resolved to make the wait for
                // scrammable promises explicit.
                //
                // Now when we create a sub-destructible, because we know that
                // the promise we'll await is scrammable, we add it to a list of
                // scrammable promises. We await any promises in the list while
                // there are promises in the list.

                // If we are the root or ephemeral, set a scram timer. Otherwise
                // wait for the scram timer of our parent root or ephemeral.
                if (this._timeout != Infinity) {
                    this._scramTimer = delay(this._timeout)
                    this._scram.wait(() => this._scramTimer.clear())
                    await this._scramTimer
                    this._scram.unlatch()
                } else {
                    await new Promise(resolve => this._scram.wait(resolve))
                }

                // Wait for any scrammable promises. Reducing the list is
                // performed on the resolution side.
                while (this._scrammable.length) {
                    await this._scrammable[0].promise
                }

                // Calcuate the resolution of this `Destructible`.
                this._return()
            }
       }
    }

    // `destructible.destroy()` &mdash; Destroy the `Destructible` and
    // ultimately destroy every `Destructible` in the tree rooted by the upper
    // most ephemeral `Destructible` or the root Destructible if no ephemeral
    // `Destructible` exists.

    //
    destroy () {
        this._destroy({})
    }

    //

    // Check to see if this `Destructible` has completed its shutdown
    // if it is destroyed. If the destructible has completed shutdown stop the
    // scram timer and toggle the scram timer latch.
    _complete () {
        if (this.destroyed && this.waiting.length == 0) {
            this._scram.unlatch()
            return true
        } else {
            return false
        }
    }

    _setResult (key, result) {
        if (result !== (void(0))) {
            if (Array.isArray(key)) {
                let iterator = this._results
                const path = key.slice()
                while (path.length != 1) {
                    if (!(path[0] in iterator)) {
                        iterator[path[0]] = {}
                    }
                    iterator = iterator[path[0]]
                    path.shift()
                }
                iterator[path[0]] = result
            } else {
                this._results[key] = result
            }
        }
    }

    async _awaitPromise (ephemeral, key, operation) {
        const wait = { ephemeral, key }
        this.waiting.push(wait)
        try {
            try {
                this._setResult(key, await operation)
            } finally {
                this.waiting.splice(this.waiting.indexOf(wait), 1)
            }
            if (!ephemeral) {
                this._destroy({ key, ephemeral })
            }
        } catch (error) {
            this._destroy({ key, ephemeral }, error)
        } finally {
            this._complete()
        }
    }

    async _awaitScrammable (ephemeral, key, operation) {
        const scrammable = new Future
        this._scrammable.push(scrammable)
        try {
            await this._awaitPromise(ephemeral, key, operation)
        } finally {
            this._scrammable.splice(this._scrammable.indexOf(scrammable), 1)
            scrammable.resolve()
        }
    }

    _monitor (ephemeral, key, vargs) {
        // Ephemeral destructible children can set a scram timeout.
        assert(typeof vargs[0] != 'function')
        if (vargs[0] instanceof Promise) {
            this._awaitPromise(ephemeral, key, vargs.shift())
            if (vargs.length != 0) {
                return this.destruct(vargs.shift())
            }
        } else {
            // Ephemeral sub-destructibles can have their own timeout and scram
            // timer, durable sub-destructibles are scrammed by their root.
            const timeout = ephemeral && typeof vargs[0] == 'number' ? vargs.shift() : Infinity
            // Create the child destructible.
            const destructible = new Destructible(timeout, key)

            // Destroy the child destructible when we are destroyed.
            const destruct = this.destruct(() => destructible.destroy())
            destructible.destruct(() => this.clear(destruct))

            // If the child is ephemeral, only destroy the parent on error,
            // otherwise, destroy the parent when the child is destroyed. Do not
            // remove the curly braces. We do not want `destruct` to wait on the
            // `Promise` returned by `_destroy`.
            if (!ephemeral) {
                destructible.destruct(() => {
                    this._destroy({ key, ephemeral })
                })
            }

            // Scram the child destructible if we are scrammed. Cancel our scram
            // forwarding if the child's `_scram` unlatches. (A `Destructible`
            // will  unlatch`_scram` when it completes normally and no scram is
            // necessary.) Note that we can't use `Promise`s because `then` is
            // not cancellable, but `Signal.wait()` is.
            const scram = this._scram.wait(() => destructible._scram.unlatch())
            destructible._scram.wait(() => this._scram.cancel(scram))

            // Monitor our new destructible as child of this destructible.
            this._awaitScrammable(ephemeral, key, destructible.promise)

            return destructible
        }
    }

    // Monitor an operation that lasts the lifetime of the `Destructible`. When
    // the promise resolves or rejects we perform an orderly shutdown of the
    // `Destructible`.

    //
    durable (key, ...vargs) {
        return this._monitor(false, key, vargs)
    }

    // Monitor an operation that does not  last the lifetime of the
    // `Destructible`. Only when the promise rejects do we perform an orderly
    // shutdown of the `Destructible`.

    //
    ephemeral (key, ...vargs) {
        return this._monitor(true, key, vargs)
    }

    static Error = Interrupt.create('Destructible.Error')
}

module.exports = Destructible
