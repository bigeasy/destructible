const delay = require('delay')
const Latch = require('prospective/latch')
const Future = require('prospective/future')
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

// `Destructible` manages multiple concurrent `async` JavaScript functions and
// registers functions for cancellation. It creates a dependency tree for
// destructors. A root `Destructible` instance can be used to create
// sub-`Destructible` instances that will destruct when the root destructs.
// sub-`Destructible` instances can create further sub-`Destructible` instances
// and so on.
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

        this._errors = []

        this._destructors = []
        this._expired = new Latch
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
                destructible: this.key,
                waiting: this.waiting.slice(),
                context: this.context
            }))
        } else if (this._errors.length != 0) {
            this._completed.resolve(new Destructible.Error('error', this._errors, {
                key: this.key,
                waiting: this.waiting.slice(),
                context: this.context
            }))
        } else {
            this._completed.resolve(null, this._results)
        }
    }

    async _fireAndForgetDestroy (context, error) {
        // We're going to say that the first error reported is a root cause of
        // the end of the `Destructible` but I don't see where I'm actually ever
        // using this. TODO Might be better to report an error with the order in
        // which it was reported.
        if (this.cause == null) {
            this.cause = {
                module: 'destructible',
                method: context.method,
                ephemeral: context.ephemeral || null,
                key: this.key,
                monitorKey: context.key || null
            }
        }
        // If there is an error, push the error onto the list of errors.
        if (error != null) {
            this._errors.push([ error, context ])
        }
        // If we've not yet been destroyed, let's start the shutdown.
        if (!this.destroyed) {
            this.destroyed = true
            // Run our destructors.
            while (this._destructors.length != 0) {
                try {
                    await this._destructors.shift().call(null)
                } catch (error) {
                    this._errors.push([ error, {
                        method: 'destruct', key: this.key
                    } ])
                }
            }
            // If we're complete, we can resolve the `Destructible.promise`,
            // otherwise we need to start and wait for the scram timer.
            if (this._complete()) {
                this._return()
            } else {
                if (this._timeout != Infinity) {
                    const timer = (this._scramTimer = delay(this._timeout))
                    this._expired.await(() => this._scramTimer.clear())
                    await timer
                    this._expired.unlatch()
                    await new Promise(resolve => setImmediate(resolve))
                } else {
                    const future = new Future
                    this._expired.await(future.resolve.bind(future))
                    await future.promise
                }
                this._return()
            }
       }
    }

    //

    // Internal destroy launches the `async` fire and forget destroy. Called
    // from some arrow functions so we wrap to swallow the promise.
    _destroy (context, error) {
        this._fireAndForgetDestroy(context, error)
    }

    // `destructible.destroy()` &mdash; Destroy the `Destructible` and
    // ultimately destroy every `Destructible` in the tree rooted by the upper
    // most ephemeral `Destructible` or the root Destructible if no ephemeral
    // `Destructible` exists.

    //
    destroy () {
        this._fireAndForgetDestroy({ method: 'destroy' })
    }

    //

    // Check to see if this `Destructible` has completed its shutdown
    // if it is destroyed. If the destructible has completed shutdown stop the
    // scram timer and toggle the scram timer latch.
    _complete () {
        if (this.destroyed && this.waiting.length == 0) {
            this._expired.unlatch()
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

    async _awaitPromise (ephemeral, method, key, operation) {
        const wait = { module: 'destructible', method, ephemeral, key }
        this.waiting.push(wait)
        try {
            try {
                this._setResult(key, await operation)
            } finally {
                this.waiting.splice(this.waiting.indexOf(wait), 1)
            }
            if (!ephemeral) {
                this._destroy({ method, key, ephemeral })
            }
        } catch (error) {
            this._destroy({ method, key, ephemeral }, error)
        } finally {
            this._complete()
        }
    }

    async _awaitBlock (destructible, ephemeral, key, promise) {
        // Add a waiting entry for the initialization block. If we expire
        // before the block completes the block wait will be reported in a
        // scram type error.
        const wait = {
            module: 'destructible',
            method: 'block',
            ephemeral: ephemeral,
            parentKey: this.key,
            key: key
        }
        destructible.waiting.push(wait)
        try {
            await promise
        } catch (error) {
            // User will have a copy.
        } finally {
            destructible.waiting.splice(destructible.waiting.indexOf(wait), 1)
            destructible._complete()
        }
    }

    _monitor (ephemeral, key, vargs) {
        // Ephemeral destructible children can set a scram timeout.
        const operation = vargs.shift()
        if (operation instanceof Promise) {
            this._awaitPromise(ephemeral, 'promise', key, operation)
            if (vargs.length != 0) {
                return this.destruct(vargs.shift())
            }
        } else {
            const timeout = ephemeral && typeof vargs[0] == 'number' ? vargs.shift() : Infinity
            // Create the child destructible.
            const destructible = new Destructible(timeout, key)

            // Destroy the child destructible when we are destroyed.
            const destruct = this.destruct(() => destructible.destroy())
            destructible.destruct(() => this.clear(destruct))

            const method = 'block'
            // If the child is ephemeral, only destroy the parent on error,
            // otherwise, destroy the parent when the child is destroyed.
            if (!ephemeral) {
                destructible.destruct(() => this._destroy({ method, key, ephemeral }))
            }

            // Scram the child destructible if we are scrammed.
            const scram = this._expired.await(() => destructible._expired.unlatch())
            destructible._expired.await(() => this._expired.cancel(scram))

            // Monitor our new destructible as child of this destructible.
            this._awaitPromise(ephemeral, 'block', key, destructible.promise)

            // Run the initialization block and then remove our waiting entry
            // and check for completion.
            const result = operation.call(null, destructible)
            if (result instanceof Promise) {
                this._awaitBlock(destructible, ephemeral, key, result)
            }
            return result
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
}

Destructible.Error = Interrupt.create('Destructible.Error')

module.exports = Destructible
