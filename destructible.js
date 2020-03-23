// Node.js API.
const assert = require('assert')

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

        this.destructed = new Promise((...vargs) => this._destructed = vargs)

        this.waiting = []

        this._increment = 0

        this._scrammable = []

        this._errors = []

        this._errored = false

        this._destructors = []
        // Yes, we still need `Signal` because `Promise`s are not cancelable.
        this._scrams = []

        this._results = {}
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
            this._destructed[1].call(null, new Destructible.Error('scrammed', this._errors, {
                key: this.key,
                context: this.context,
                waiting: this.waiting.slice()
            }))
        } else if (this._errors.length != 0) {
            this._destructed[1].call(null, new Destructible.Error('error', this._errors, {
                key: this.key,
                context: this.context,
                waiting: this.waiting.slice()
            }))
        } else {
            this._destructed[0].call(null, this._results)
        }
    }

    // Temporary function to ensure noone is using the cause property.
    get cause () {
        throw new Error
    }

    // This is our internal destroy. We run it as an async function which
    // creates a new strand of execution. Nowhere do we wait on the promise
    // returned by executing this function nor should we. It is fire and forget.
    // Hung or rejected child promises are reported through an `Interrupt`
    // generated error through the `Destructible.promise`.

    //
    async _destroy () {
        // If we've not yet been destroyed, let's start the shutdown.
        if (!this.destroyed) {
            this.destroyed = true
            // Run our destructors.
            while (this._destructors.length != 0) {
                try {
                    await this._destructors.shift().call()
                } catch (error) {
                    this._errors.push([ error, { method: 'destroy' } ])
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
                    const timer = { timeout: null, resolve: null }
                    this._scrams.push(() => {
                        clearTimeout(timer.timeout)
                        timer.resolve.call()
                    })
                    await new Promise(resolve => {
                        timer.resolve = resolve
                        timer.timeout = setTimeout(resolve, this._timeout)
                    })
                    this._scram()
                } else {
                    await new Promise(resolve => this._scrams.push(resolve))
                }

                // Wait for any scrammable promises. Reducing the list is
                // performed on the resolution side.
                while (this._scrammable.length) {
                    await this._scrammable[0]
                }

                // Calcuate the resolution of this `Destructible`.
                this._return()
            }
       }
    }

    // Increment a countdown to destruction. Calling `increment()` increments an
    // internal counter. Calling `decrement()` decrements the internal counter.
    // When the counter reaches zero, the `Destructible` is destroyed. If you do
    // not call `increment` or `decrement` it has no effect on the
    // `Destructible`. After calling `increment` you can still call `destroy()`
    // to explicit and immediately destroy the `Destructible`. The completion of
    // a durable `Promise` will also explicitly and immediately destroy the
    // `Destructible`.

    //
    increment (increment = 1) {
        this._increment += increment
    }

    decrement (decrement = 1) {
        this._increment -= decrement
        if (this._increment == 0) {
            this._destroy()
        }
    }

    // `destructible.destroy()` &mdash; Destroy the `Destructible` and
    // ultimately destroy every `Destructible` in the tree rooted by the upper
    // most ephemeral `Destructible` or the root Destructible if no ephemeral
    // `Destructible` exists.
    //
    // We kept this wrapper function because we do not want to return the
    // promise that is returned by `_destroy()`.

    //
    destroy () {
        this._destroy()
    }

    // We keep this as an array of functions, as opposed to an array of
    // children, because we push a scram timer canceller or forever waiter onto
    // the end of the array of scrams. Seems like we could just keep the
    // canceller/waiter as a separate variable, for when we `_complete`, but it
    // may also be the case that we're an ephemeral destructible waiting on a
    // our own scram, when our parent, with a shorter timeout scrams. Now
    // `_scram` will scram all our children and tell us to to stop waiting.
    // `_complete` will only ever tell us to stop waiting because all our
    // children will have completed.

    //
    _scram () {
        while (this._scrams.length != 0) {
            this._scrams.shift()()
        }
    }

    //

    // Check to see if this `Destructible` has completed its shutdown
    // if it is destroyed. If the destructible has completed shutdown stop the
    // scram timer and toggle the scram timer latch.
    _complete () {
        if (this.destroyed && this.waiting.length == 0) {
            this._scram()
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

    // The `_scrams` array is an array of functions that call the `_scram` of a
    // destructible, while the `_scrammable` array is an array of semaphores
    // that blocks a parent `Destructible` from resolving a scram timeout.
    //
    // We need to remove the scram function from `_scrams` immediately, before
    // we call destroy, which is why have it crowded in here instead of our our
    // `_awaitScrammable` wrapper. We don't have `_scammable` management in here
    // because it would just mean two extra `if` statements when we already
    // know.

    async _awaitPromise (ephemeral, key, operation, scram) {
        const wait = { ephemeral, key }
        this.waiting.push(wait)
        try {
            try {
                const result = await operation
                if (!ephemeral) {
                    this._setResult(key, await result)
                }
            } finally {
                this.waiting.splice(this.waiting.indexOf(wait), 1)
                const index = this._scrams.indexOf(scram)
                if (~index) {
                    this._scrams.splice(index, 1)
                }
            }
            if (!ephemeral) {
                this._destroy()
            }
        } catch (error) {
            this._errored = true
            this._errors.push([ error, { method: ephemeral ? 'ephemeral' : 'durable', key } ])
            this._destroy()
        } finally {
            this._complete()
        }
    }

    // Await the promise of a sub-destructible. We know that a sub-destructible
    // will always resolve due to our scram logic, so we maintain a list of
    // scrammable futures for the parent to wait for after it has been notified
    // of a scram timeout. See scram logic above for more details.

    // Here we are creating a block that is protected by a `Promise`. We want to
    // wait for the `operation`, but we don't want to wait on the `operation`
    // because it's not ours and it may reject, so we create a tracking
    // `Promise`. We should probably rename `_scrams` to `_children`.
    //
    // Separate function because the promise is fire and forget, we don't wait
    // for it in `_await` and `_await` needs to return the `Destructible` it
    // creates.

    //
    async _awaitScrammable (ephemeral, key, operation, scram) {
        const scrammable = {}
        this._scrammable.push(new Promise(resolve => scrammable.resolve = resolve))
        try {
            await this._awaitPromise(ephemeral, key, operation, scram)
        } finally {
            this._scrammable.splice(this._scrammable.indexOf(scrammable), 1)
            scrammable.resolve.call()
        }
    }

    // To implement scrammable, it seemed that we want to make the last argument
    // the scram function instead of a destructor, which is never all that
    // pleasant to look at anyway, but then we need to have a major version bump
    // because it breaks the interface in a way that is hard to see.
    //
    // The scramability of a `Promise` is a property of the promise, while the
    // destructibility is more a property of the desctructible. The
    // implementation as it stands points in this direction and I'm not going
    // back to rethink it all. Software as Plinko.
    //
    _await (ephemeral, key, vargs) {
        // Ephemeral destructible children can set a scram timeout.
        if (typeof vargs[0] == 'function') {
            vargs[0] = vargs[0].call()
            this._await(ephemeral, key, vargs)
        } else if (vargs[0] instanceof Promise) {
            const promise = vargs.shift()
            assert(vargs.length == 0, 'no more user scrammable')
            this._awaitPromise(ephemeral, key, promise, null)
        } else {
            // Ephemeral sub-destructibles can have their own timeout and scram
            // timer, durable sub-destructibles are scrammed by their root.
            const timeout = ephemeral && typeof vargs[0] == 'number' ? vargs.shift() : Infinity
            // Create the child destructible.
            const destructible = new Destructible(timeout, key)

            // Destroy the child destructible when we are destroyed.
            const destruct = this.destruct(() => {
                destructible._destroy()
            })

            // Propagate destruction on error. Recall that we need to send this
            // message up though our alternate route, we can't wait on the
            // promise of a sub-destructible to complete and propagate the
            // returned error. Why do we have scram if we can rely on that
            // return? We need a separate `_errored` boolean, we can't just
            // check `_errored.length` because of scram, and because we have
            // some objects that only shutdown from a user function (Conduit,
            // Turnstile, Fracture) so they're going to need to be scrammed, we
            // kind of want them to be scrammed, or else the user has to think
            // hard about the difference between ordered shutdown and abnormal
            // shutdown.
            destructible.destruct(() => {
                this.clear(destruct)
                if (!ephemeral || destructible._errored) {
                    this._errored = true
                    this._destroy()
                }
            })

            // Scram the child destructible if we are scrammed. Cancel our scram
            // forwarding if the child's `_scrams` unlatches. (A `Destructible`
            // will  unlatch`_scrams` when it completes normally and no scram is
            // necessary.) Note that we can't use `Promise`s because `then` is
            // not cancellable, but `Signal.wait()` is. If we used
            // `Promise.then`, then a long-running, like a server, would have an
            // ever growing list of callbacks for a short-term child, like a
            // socket connection.

            // Propagate scram cancelling propagation if child exits.
            const scram = () => destructible._scram()
            this._scrams.push(scram)

            // Monitor our new destructible as child of this destructible.
            this._awaitScrammable(ephemeral, key, destructible.destructed, scram)

            return destructible
        }
    }

    // Await an operation that lasts the lifetime of the `Destructible`. When
    // the promise resolves or rejects we perform an orderly shutdown of the
    // `Destructible`.

    //
    durable (key, ...vargs) {
        return this._await(false, key, vargs)
    }

    // Await an operation that does not last the lifetime of the `Destructible`.
    // Only when the promise rejects do we perform an orderly shutdown of the
    // `Destructible`.

    //
    ephemeral (key, ...vargs) {
        return this._await(true, key, vargs)
    }

}

Destructible.Error = Interrupt.create('Destructible.Error')

module.exports = Destructible
