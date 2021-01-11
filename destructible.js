// Node.js API.
const assert = require('assert')

// Exceptions that you can catch by type.
const Interrupt = require('interrupt')

// A Promise wrapper that captures `resolve` and `reject`.
const Future = require('perhaps')

// A linked-list to track promises, scrams.
const List = require('./list')

// `Destructible` is a utility for managing concurrent operations in
// `async`/`await` style JavaScript programs. The fundimental concept of
// `Destructible` is the "strand." A strand conceptually a thread, but it does
// not run as a light-weight process. It is defined as an independent
// `async`/`await` call stack.
//
// The typical example of a minimal `async`/`await` program is as follows.
//
// ```javascript
// async function main () {
//     const fs = require('fs').promises
//     console.log(await fs.readFile(__filename, 'utf8'))
// }
//
// main()
// ```
//
// `await` can only be called within an `async` function, so we create an
// `async` function named `main`. We then call it without `await` and relying on
// the default unhandled exception handler to report any exceptions. The `main`
// function here represents a single strand in a JavaScript program.
//
// But what if we wait to do to things at once? Imagine an `async`/`await` based
// server using `await` to pull buffers off of a socket, with a loop for each
// socket. Each of those loops represents an `async`/`await` call stack. They
// can each raise and propagate an exception. Each of those loops is a strand.
//
// `Destructible` simplifis this sort of multi-loop/multi-stack/multi-strand
// programming so that it looks a lot like multi-threaded programming.
//
// _`Destructible` in practice appears to be awaiting `async` functions, but in
// reality and often in practice it is really awaiting `Promise`s. For the rest
// of this document we will talk about `Promise`s and not `async` functions but
// they are synonymous. I just don't want you to think that you must wrap a
// `Promise` you need to resolve in a function call._
//
// `Destructible` awaits multiple concurrent JavaScript `Promise`s grouped
// together as a `Promise` group. Additionally, `Destructible` registers
// destructor functions of your design that will cancel the `Promise`s it is
// awaiting. `Destructible` will allow you to stop all the awaited `Promise`s at
// once and return.
//
// Unlike `Promise.all`, `Destructible` will ensure that all the promises return
// when any `Promise` rejects and that all exceptions are reported instead of
// just the first one to reject. Reporting all execeptions is important because
// the first exception may only be the proixmate cause of failure.
//
// When you cancel a `Destructible` it will fire all the destructor functions
// you registered to cancel all the `Promises`s you registered. Cancellation is
// defined by you, the user. Perhaps you have to abort a socket connection or
// cancel a timer. `Destructible` helps you organize all your shutdown
// procedures and ensure that they run in order. It also helps you order the
// shutdown of strands, so that background strands that need to continue to run
// during shutdown shutdown after forground strands finish.
//
// And by background and foreground I do mean any number of layers of such
// dependencies, not just the two. Your server may depend on a database that
// depends on a memory cache and you can shut them down one, two, three.
//
// _**TODO** Above is a tidy and a rewrite that is consume what comes below.
// What is above could be moved to the `README.md`._
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
    static Error = Interrupt.create('Destructible.Error', {
        INVALID_TRACER: 'tracer must be a function that takes a single argument',
        INVALID_ARGUMENT: `
            the strand constructor argument must be a function, Promise, initial countdown, or nothing at all
        `,
        INVALID_COUNTDOWN: {
            code: 'INVALID_ARGUMENT',
            message: 'the countdown must be an integer zero or greater, got: %(_countdown)d'
        },
        TRACER_DID_NOT_INVOKE: {
            code: 'INVALID_TRACER',
            message: 'tracer did not call given function'
        },
        NOT_A_DESTRUCTIBLE: {
            code: 'INVALID_ARGUMENT',
            message: 'argument must be an instance of Destructible'
        },
        NOT_DEFERRABLE: 'attempt to increment countdown of a destructible that is not deferrable',
        DESTROYED: 'attempt to launch new strands after destruction',
        EXCEPTIONAL: 'strand raised an exception',
        ERRORED: 'strand exited with exception',
        SCRAMMED: 'strand failed to exit or make progress',
        DURABLE: 'early exit from a strand expected to last for entire life of destructible'
    })

    // `new Destructible([ scram ], id)` constructs a new `Destructible` to act
    // as the root of a tree of parallel concurrent strands.
    //
    // The `Destructible` will scram after the given `scram` timeout or the
    // default `1000` milliseconds if not given. A scram is an exception raised
    // when one or more strands fails to resolve or make progress before the
    // given timeout.
    //
    // The `id` can be any JSON serializable object. It is displayed in the
    // `Destructible` in the stack trace on error. It is also available through
    // the `id` property of the `Destructible`. The `id` is not required by
    // `Destructible` to be unique. It is for your reference.

    //
    constructor (...vargs) {
        this._trace = typeof vargs[0] == 'function' ? vargs.shift() : null

        this._instance = Symbol('INSTANCE')

        this._timeout = typeof vargs[0] == 'number' ? vargs.shift() : 1000

        this._ephemeral = true

        this._properties = Object.defineProperties({}, {
            $trace: {
                value: this._trace,
            },
            instance: {
                value: Symbol('INSTANCE'),
                enumberable: false,
                configurable: true
            }
        })

        this.id = vargs.shift()

        this.destroyed = false

        this._promise = new Future

        this._done = new Future

        this._parent = null

        this.durables = 0

        this.ephemerals = 0

        this._waiting = new List

        this._children = new List

        this._child = null

        this._drain = Future.resolve()

        this._countdown = 0

        this.deferrable = true

        this._scrammable = new List

        this._errors = []
        //

        // **TODO** Progress also needs an isolation treatment. Imagine you have
        // a server with thousands of sockets opening and closing quickly. You
        // have ephemeral sub-trees for each socket. One socket isn't shutting
        // down, but the progress reports form all the other sockets are keeping
        // it from scramming. Should be easy to implement by cribbing from
        // panic.

        //
        this._progress = []

        this._isolation = { errored: false, panic: [] }

        this._destructing = false

        this._destructors = new List

        this._scrams = new List

        this._panic = new List

        this._results = {}
    }

    get promise () {
        return this._promise.promise
    }

    get done () {
        if (! this._done.fulfilled) {
            return this._done.promise
        }
        return null
    }

    get countdown () {
        return this._countdown
    }

    get errored () {
        return this._isolation.errored
    }

    isDestroyedIfDestroyed (destructible) {
        Destructible.Error.assert(destructible instanceof Destructible, 'NOT_A_DESTRUCTIBLE')
        const path = []
        let iterator = this, boundary
        do {
            path.push(iterator)
            boundary = iterator.deferrable
            iterator = iterator._parent
        } while (iterator != null && ! boundary)
        iterator = destructible
        do {
            if (~path.indexOf(iterator)) {
                return true
            }
            boundary = iterator.deferrable || iterator._ephemeral
            iterator = iterator._parent
        } while (iterator != null && ! boundary)
        return false
    }

    // `destructible.destruct(f)` &mdash; Register a destructor `f` that will be
    // called when this `Destructible` is destroyed.

    //
    destruct (f) {
        return this._destructors.push(f)
    }

    panic (f) {
        return this._panic.push(f)
    }

    // `destructible.destruct(f)` &mdash; Remove the registered destructor `f`
    // from the list of destructors to call when this `Destructible` is
    // destroyed.
    //
    // TODO Maybe return cleared function? Now that you're iterating over a
    // list, how do you do this?

    //
    clear (handle) {
        if (typeof handle[Symbol.iterator] == 'function') {
            for (const _handle of handle) {
                this.clear(_handle)
            }
        } else {
            List.unlink(handle)
        }
    }

    //

    // Internal method for processing the return value when either all monitored
    // promises have resolved or the shutdown failed to complete before the
    // scram timeout.
    _return () {
        while (! this._panic.empty) {
            this._panic.shift()
        }
        if (this._child != null) {
            List.unlink(this._child)
        }
        if (! this._waiting.empty || this._countdown != 0) {
            this._promise.reject(new Destructible.Error('SCRAMMED', this._errors, {
                id: this.id,
                countdown: this._countdown,
                waiting: this._waiting.slice()
            }, this._properties))
        } else if (this._errors.length != 0) {
            this._promise.reject(new Destructible.Error('ERRORED', this._errors, {
                id: this.id,
                countdown: this._countdown,
                waiting: this._waiting.slice()
            }, this._properties))
        } else {
            this._promise.resolve()
        }
        this._done.resolve()
    }

    // Temporary function to ensure noone is using the cause property.
    get cause () {
        throw new Error
    }

    operational (additional = true) {
        if (this.destroyed && additional) {
            throw new Destructible.Error('DESTROYED', this._properties)
        }
    }

    // When this was an error-first callback library, scram was synchronous and
    // the chain of scrams implemented as callbacks stored in a Signal object,
    // which we can just imagine is an array of callbacks all waiting for a
    // common response. Here we'd add ourselves to the end of our own array of
    // callbacks knowing that all our children will get the scram before we do.
    // When a child reports a scrammed exception on a waiting callback, the
    // parent of that child get that exception as a resolution of the child
    // &mdash; instead of reporting the child as waiting, it will report an
    // error, the cause of that error will be the child's scram exception.
    //
    // Now that we're using Promises we can't just fire scram and expect all
    // children to either raise scram exception or propagate a scram exception
    // because the destroy operations waiting on the child's resolution will not
    // execute until the next tick. Now we need to wake from our scram timer or
    // else wake from waiting on the expired message to and then wait again for
    // the parents of our grand children to respond to the resolution of their
    // children's promises.
    //
    // For a moment there, we where using the event-loop order to resolve this.
    // Because the order is next tick, promises, immediate, if we wait on a
    // promise we're just going to have everyone hop in a queue and hop out
    // again in the same order before resolving their promises. When we wait on
    // immediate we create a new queue where we run in the same order, so that
    // our greatest grand child will resolve its promise, then its parent will
    // run later. In the mean time, the child's promise will invoke the destroy
    // logic because promises precede immediates.
    //
    // And then there was a need to have more than one immediate after to the
    // root timer. I wasn't certain if two did the trick or if the number of
    // immediates needed was dependent on the depth of the sub-destructible
    // tree. I didn't take bother to take the time to reason about it. The
    // event-loop trickery was too opaque and I'd already resolved to make the
    // wait for scrammable promises explicit.
    //
    // Now when we create a sub-destructible, because we know that the promise
    // we'll await is scrammable, we add it to a list of scrammable promises. We
    // await any promises in the list while there are promises in the list.

    // If we are the root or ephemeral, set a scram timer. Otherwise wait for
    // the scram timer of our parent root or ephemeral.
    //
    // `Infinity` means that this is either a root destructible or an ephemeral
    // child. An ephemeral child is a sub-destructible that does not last the
    // lifetime of the parent, therefore when it shuts down, it ought to set its
    // own scram timer and scram itself if it does not shutdown in a reasonable
    // amount of time.
    //
    // At the time of writing this comment, we've just added the `progress()`
    // function to indicate that we're making progress on shutdown.
    //
    // Prior to this, the reasoning was that the ephemerals would always run
    // their own timers, and it would be up to the user to determine how long it
    // should take to shut down, then to somehow account for a plethora of
    // epehermals in an application like a server, where you may have an
    // ephemeral per socket connection and thousands of sockets. A socket should
    // take a second to shut down during normal operation, to send a final
    // handshake of some sort, and if you have thousands of sockets then the
    // root destructible should account for the shutdown of each socket, hmm...
    // is five minutes enough? Where's my calculator?
    //
    // With the `progress()` function a timeout is based on progress, or not if
    // you never call `progress()`. Each socket will call progress as it
    // performs the steps in its handshake indicating that it making progress.

    //
    async _shutdown () {
        if (this._ephemeral) {
            const scram = { timeout: null, resolve: null }
            // We got officially scrammed. We set progress to false on the off
            // chance that it is somehow true so we don't continue to wait.
            // Defensive programming.
            this._scrams.push(() => {
                this._progress[0] = false
                clearTimeout(scram.timeout)
                scram.resolve()
            })
            this._progress[0] = true
            while (! this._waiting.empty && this._progress[0]) {
                this._progress[0] = false
                // **TODO** Use Future.
                await new Promise(resolve => {
                    scram.resolve = resolve
                    scram.timeout = setTimeout(resolve, this._timeout)
                })
                if (! this._ephemeral) {
                    this._scrams.pop()
                    return await this._shutdown()
                }
            }
            this._scram()
        } else {
            await new Promise(resolve => this._scrams.push(resolve))
        }

        // Wait for any scrammable promises. Reducing the list is performed on
        // the resolution side. They will all return now because they have all
        // been scrammed. Use to be synchrnonous when error-first callback, but
        // we now have to await the micro-stask queue.
        while (!this._scrammable.empty) {
            await this._scrammable.peek().promise
        }

        // Calcuate the resolution of this `Destructible`.
        this._return()
    }
    //

    // `destructible.destroy()` &mdash; Destroy the `Destructible` and
    // ultimately destroy every `Destructible` in the tree rooted by the upper
    // most ephemeral `Destructible` or the root Destructible if no ephemeral
    // `Destructible` exists.
    //
    // Actually, that's an error if the destructible is durable.
    //
    // We return `this` so we can call `destroy()` and await on `promise` or
    // `done` in one line.

    //
    destroy () {
        // If we've not yet been destroyed, let's start the shutdown.
        if (!this.destroyed) {
            //
            this.destroyed = true
            //

            // Add our panic list to the isolation panic list, but only if we
            // are not destructing in an error state. We only run `panic` if
            // `destruct` is not already called in an `errored` state.

            // Any ephemeral created after destruction will be isolated, it will
            // only enter the errored state if an error occurs in that sub-tree.

            //
            if (! this._isolation.errored) {
                this._isolation.panic.push(this._panic)
            }
            //

            // Run our destructors. They are synchronous. If they want to do
            // something asynchronous they can create an ephemeral while the
            // destructor is running. That ephemeral can create further
            // sub-destructibles. Thus, running new sub-destructibles after
            // destruction takes some determination.

            //
            this._destructing = true
            while (!this._destructors.empty) {
                try {
                    this._destructors.shift().call()
                } catch (error) {
                    this._errors.push(new Destructible.Error('DESTROY', [ error ], this._properties))
                }
            }
            this._destructing = false
            //

            // If we're complete, we can resolve the `Destructible.promise`,
            // otherwise we need to wait for the scram timer.

            //
            if (this._complete()) {
                this._return()
            } else {
                this._shutdown()
            }
       }

       // Allow for a bit of method chaining.
       return this
    }
    //

    // **TODO** For documentation, this is a new convention. Drain returns a
    // `Promise` if something is awaiting `null` otherwise. Allows to
    // synchornously do nothing and know you did nothing.

    // An ephemeral could be added after the drain promise is resolved but
    // before the drain function continues. Not really a race condition. We
    // could simply await the drain. Drain is only ever used to ensure that a
    // particular write flushed, or work in a work queue completed, that
    // progress was made past a certian point or alternatively, that everything
    // has shut down. Although, in the shutdown case, we do have a race unless
    // we're certain that, well we have to be certain that new ephemerals are
    // only created by ephemerals, you don't use drain to test done.

    //
    drain () {
        if (this.ephemerals != 0) {
            return (async () => {
                while (this.ephemerals != 0) {
                    if (this._drain.fulfilled) {
                        this._drain = new Future
                    }
                    await this._drain.promise
                }
            }) ()
        }
        return null
    }

    // TODO Now with operative we might want to have another property for this
    // countdown, which we might call countdown, and if it is never set to
    // anything it is ignored.

    // Increment a countdown to destruction. Calling `increment()` increments an
    // internal counter. Calling `decrement()` decrements the internal counter.
    // When the counter reaches zero, the `Destructible` is destroyed. If you do
    // not call `increment` or `decrement` it has no effect on the
    // `Destructible`. After calling `increment` you can still call `destroy()`
    // to explicit and immediately destroy the `Destructible`. The completion of
    // a durable `Promise` will also explicitly and immediately destroy the
    // `Destructible`.

    //
    increment () {
        Destructible.Error.assert(this.deferrable, 'NOT_DEFERRABLE', { id: this.id })
        this._countdown++
    }

    decrement () {
        Destructible.Error.assert(this.deferrable, 'NOT_DEFERRABLE', { id: this.id })
        if (this._countdown == 0) {
        } else if (--this._countdown == 0) {
            this.destroy()
        }
        return this
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
        // TODO New stuff, come back and rewrite when it's old stuff. We get
        // told to scram, but we've not destroyed. That means that someone
        // created a child destructible that they needed to stay alive after the
        // parent is destroyed — the parent can write to services in the child
        // that would attempt to create a new `ephemeral` and error.
        //
        // Now that `destroy` is synchronous, when we call it, it will call
        // destroy on all children and it will synchronously build a scram chain
        // so that the next call to run our scrams will propagate scrams.
        if (!this.destroyed) {
            this.destroy()
        }
        while (!this._scrams.empty) {
            this._scrams.shift()()
        }
    }

    // Check to see if this `Destructible` has completed its shutdown if it is
    // destroyed. If the destructible has completed the call to scran does not
    // actually scram, it just wakes up the scram timer.
    _complete () {
        if (this.destroyed && this._waiting.empty) {
            this._scram()
            return true
        } else {
            return false
        }
    }

    // This is becoming increasingly dubious. I've never used it. Might be
    // better to just return the result of `durable` or `ephemeral` if that's
    // what you want, but uh, no. That doesn't make sense, oh, no it does, it's
    // pretty much the same thing, this is the result of `durable`.
    //
    // **TODO** Exceedingly dubious and I don't want to document it.
    //
    // ```
    // const result = {
    //     first: await destructble('first', this._first()),
    //     second: await destructible('second', this._second()),
    // }
    // await destructible.rejected
    // return result
    // ```
    //
    // How is that any different? Not the result of `rejected`, but still.

    //

    // The `_scrams` array is an array of functions that call the `_scram` of a
    // destructible, while the `_scrammable` array is an array of semaphores
    // that blocks a parent `Destructible` from resolving a scram timeout.
    //
    // We need to remove the scram function from `_scrams` immediately, before
    // we call destroy, which is why have it crowded in here instead of our our
    // `_awaitScrammable` wrapper. We don't have `_scammable` management in here
    // because it would just mean two extra `if` statements when we already
    // know.

    async _awaitPromise (operation, wait, $trace = null) {
        try {
            try {
                return await operation
            } finally {
                List.unlink(wait)
            }
        } catch (error) {
            const errored = this._isolation.errored
            this._isolation.errored = true
            // **TODO** Okay, here we go. New, new stuff.
            while (this._isolation.panic.length != 0) {
                for (const panic of this._isolation.panic.shift()) {
                    panic()
                }
            }
            if (error instanceof Destructible.Error) {
                this._errors.push(error)
            } else {
                this._errors.push(Destructible.Error.create({ $trace, $stack: 0 }, [ 'ERRORED', [ error ], wait.value ]))
            }
            this.destroy()
        } finally {
            switch (wait.value.method) {
            case 'durable': {
                    this.durables--
                    if (! this.destroyed) {
                        this._isolation.errored = true
                        this._errors.push(Destructible.Error.create({ $trace, $stack: 0 }, [ 'DURABLE', wait.value ]))
                        this.destroy()
                    }
                }
                break
            default: {
                    if (--this.ephemerals == 0) {
                        this._drain.resolve()
                    }
                }
                break
            }
            if (this.destroyed) {
                this._complete()
            }
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
    // **TODO** We're going to have race conditions if we do not push the
    // scrammable in the same synchronous run in which we check destroyed. (This
    // is getting to be an old TODO. Wondering how to examine my assumptions
    // about this. I believe this has to do with being concerned about the
    // construction location of the promise and the push, can we be assured that
    // we enter `async` functions synchronously? Experience tells me this is the
    // case in Google V8, but is it specified in the ECMA standard?)

    //
    async _awaitScrammable (destructible, wait, scram) {
        // Monitor our new destructible as child of this destructible.
        const scrammable = new Future
        const node = this._scrammable.push(scrammable)
        try {
            await this._awaitPromise(destructible.promise, wait)
        } finally {
            // TODO Convince yourself that it doens't matter if you call a
            // scrammable before you call `_complete`.
            List.unlink(scram)
            List.unlink(node)
            scrammable.resolve()
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
    _await (method, vargs) {
        if (!(this._destructing && method == 'ephemeral')) {
            this.operational()
        }
        const trace = typeof vargs[0] == 'function' ? vargs.shift() : null
        const id = vargs.shift()
        const wait = this._waiting.push({ method, id })
        // Ephemeral destructible children can set a scram timeout.
        if (typeof vargs[0] == 'function') {
            //const promise = async function () { return await vargs.shift()() } ()
            return this._awaitPromise(vargs.shift()(), wait, trace)
        } else if (vargs.length != 0 && typeof vargs[0].then == 'function') {
            return this._awaitPromise(vargs.shift(), wait, trace)
        } else if (vargs.length == 0 || typeof vargs[0] == 'object') {
            const options = vargs.shift() || {}
            // Ephemeral sub-destructibles can have their own timeout and scram
            // timer, durable sub-destructibles are scrammed by their root.
            //assert(typeof vargs[0] != 'number')
            // Create the child destructible.
            //assert(typeof this._timeout == 'number' && this._timeout != Infinity)

            const deferrable = options.countdown != null
            const countdown = deferrable ? options.countdown : 0
            Destructible.Error.assert(Number.isInteger(countdown) && countdown >= 0, 'INVALID_COUNTDOWN', { _countdown: countdown })

            const destructible = new Destructible(this._timeout, id)

            Object.defineProperty(destructible._properties, 'instance', Object.getOwnPropertyDescriptor(this._properties, 'instance'))

            // **TODO** This is new, ephemerals launched after error are
            // isolated.
            if (! options.isolated && ! this._isolation.errored) {
                destructible._isolation = this._isolation
            }

            destructible._ephemeral = method == 'ephemeral'

            destructible._countdown = countdown
            destructible.deferrable = deferrable

            destructible._trace = trace

            if (destructible._ephemeral) {
                destructible._progress = [ true ]
            }

            // **TODO** Here it is. Entirely unused. Maybe a tree report?
            destructible._child = this._children.push(destructible)

            // Destroy the child destructible when we are destroyed.
            const destruct = this.destruct(() => {
                // **TODO** This is also new and probably all we need to do for
                // progress isolation. If an ephemeral has destructed, it stops
                // at the ephemeral boundary and starts its own scram timer. If
                // destruction comes up, we do not cancel the ephemeral scram timer,
                // assuming that it is doing a fine job and that this behavior is no
                // different from normal operation. We could cancel it though, by
                // registering a destructible that wakes up the scram timer and
                // having it see that it is no longer ephemeral.
                destructible._ephemeral = false
                destructible._progress = this._progress
                if (destructible._countdown == 0) {
                    destructible.destroy()
                }
            })

            // Propagate destruction on error. Recall that we need to send this
            // message up though our alternate route, we can't wait on the
            // promise of a sub-destructible to complete and propagate the
            // returned error. Why do we have scram if we can rely on that
            // return? We need a separate `_errored` boolean, we can't just check
            // `errors.length` because of scram, and because we have some
            // objects that only shutdown from a user function (Conduit,
            // Turnstile, Fracture) so they're going to need to be scrammed, we
            // kind of want them to be scrammed, or else the user has to think
            // hard about the difference between ordered shutdown and abnormal
            // shutdown.

            // **TODO** Above comments are hard to parse now. Adding this to say
            // that we now are developing a new rule about propagating shutdown
            // upwards. It would appear that when we shutdown an ephemeral that
            // shutdown does not propagate. When we shutdown a durable it does.
            // If durable, an exception is raised when the parent processes the
            // resolve.

            // Turnstile uses `destroy` to indicate that it has encountered an
            // error. If you build destructible with a durable that error will
            // always cause an exception to be raised. It will be explicit when
            // Turnstile's shutdown strand throws an exception with gathered
            // errors nested. We can add an option to turnstile to allow errors
            // to get funneled off to logs. We want to do this because we are
            // realizing that there are alternatives to handling errors, logging
            // them as they occur, or gathering them and reporting them in the
            // stack trace. The approach depends on the application. Turnstile
            // could have a queue of thousands of writes and the disk is full,
            // every one will produce an error and the stack trace will be
            // useless. We have to build stack trace reduction into Interrupt.
            // Alternatively, Turnstile can log errors. This is easier to reason
            // about when we have a single Turnstile per application.

            // Anyway, we now have rules about destruction. It does propagate,
            // but it's not entirely harmless.

            // An error array, so that we only have to set it once, or an array
            // of errored references, those being arrays.

            //
            destructible.destruct(() => {
                this.clear(destruct)
                if (! destructible._ephemeral || destructible._isolation.errored) {
                    this._isolation.errored = this._isolation.errored || destructible._isolation.errored
                    this.destroy()
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
            const scram = this._scrams.push(() => {
                destructible._scram()
            })

            // This is added at a late date to propagate the progress flag.
            // Until now, all parent/child communication was done through
            // generalized structures so that the parent or child was just
            // another consumer of child or parent services respectively.
            // Temptation is to rethink whether this should be the case or if
            // more parent/child interation should be explicit, but rather than
            // give it a lot of thought, I'm going to assume that if I did, I'd
            // realize that this is the way it's supposed to be.

            // I now depend on this to determine if two destructibles are part
            // of the same stage.
            destructible._parent = this

            this._awaitScrammable(destructible, wait, scram)

            return destructible
        } else {
            throw new Destructible.Error('INVALID_ARGUMENT', this._properties)
        }
    }

    progress () {
        this._progress[0] = true
    }

    durable (...vargs) {
        this.durables++
        return this._await('durable', vargs)
    }

    // `async ephemeral(id, [ Promise ])` &mdash; Start a strand that does not
    // last the lifetime of the `Destructible`. Only if the `Promise` rejects do
    // we perform an orderly shutdown of the `Destructible`. No exception is
    // raised if the `Promise` of strand rejects.
    //
    // The `id` identifies the strand. It can be any JSON serializable object.
    // It is displayed in the stack trace on error. When creating a sub-group
    // the `id` available as a property of the returned `Destructible`. The `id`
    // is not required by `durable` to be unique. It is for your reference.
    //
    // This is used for background tasks that are short-term, like shuffling
    // files around in a database, or indefinate, like chatting on a socket in a
    // server where there are many sockets opening and closing whenever.
    //
    // Note that if you have an application like a server where sockets can
    // raise exceptions that destroy the socket but should not destroy the
    // server, then you should catch those exceptions in the socket strand.
    // Destructible has no facilities for rescuing exceptions. It treats any
    // exception as fatal. Catch blocks in you strands perform rescues.

    //
    ephemeral (...vargs) {
        this.ephemerals++
        return this._await('ephemeral', vargs)
    }

    _vargs (vargs) {
        const $trace = typeof vargs[0] == 'function' ? vargs.shift() : null
        const id = vargs.shift()
        const f = vargs.pop()
        return { $trace, id, f, errored: vargs }
    }
    //
    copacetic (...vargs) {
        if (! this.errored) {
            return this.destructive.apply(this, vargs)
        }
        const { errored } = this._vargs(vargs)
        if (errored.length == 1) {
            return errored[0]
        }
    }

    async _destructive ($trace, promise, id, errored) {
        try {
            return await promise
        } catch (error) {
            this._isolation.errored = true
            this._errors.push(new Destructible.Error({ $trace, $stack: 0 }, [ error ], 'ERRORED', { id: id }))
            this.destroy()
            if (errored.length == 0) {
                throw new Destructible.Error('DESTROYED', this._properties)
            }
            return errored[0]
        }
    }

    destructive (...vargs) {
        const { $trace, id, f, errored } = this._vargs(vargs)
        try {
            let result = f
            if (typeof result == 'function') {
                result = result()
            }
            if (typeof result.then == 'function') {
                return this._destructive($trace, result, id, errored)
            }
            return result
        } catch (error) {
            this._isolation.errored = true
            this._errors.push(new Destructible.Error({ $trace, $stack: 0 }, [ error ], 'ERRORED', { id: id }))
            this.destroy()
            if (errored.length == 0) {
                throw new Destructible.Error('DESTROYED', this._properties)
            }
            return errored[0]
        }
    }

    // Used to address the configuration problem I keep encountering. The
    // problem is that we're trying to setup a bunch of sub-destructibles, but
    // we encounter an error that means we have to stop before setup is
    // completed. We'd like to stop making progress on our setup, but we also
    // want to report the error, and it would be nice if it was all wrapped up
    // in `Destructible.rejected`. So, we run setup function in `attemptable`
    // and we run the possibly abortive configuration step in `awaitable`.
    //
    // Actually a more general problem. With Destructible I tend to run
    // background strands with work queues and the like. The work queue will
    // report the real error, but somewhere someone is waiting and they need an
    // exception to prevent progress. I don't want both exceptions reported. The
    // caller should get an exception to indicate that the system is shutdown,
    // but not the details of the shutdown, that would be reported through
    // `Destructible.rejected`.
    //
    // **UPDATE** Still an issue. It is a way of doing the upper must
    // initialization where something in the background could throw an
    // exception, but I don't know what I want to accomplish here. Does it
    // bother me terribly to have both the source exception from a background
    // strand and the foreground `Destructible.Error` exception? Because that is
    // going to happen a lot, so maybe we want to filter exceptions? We could
    // add a `prune` method and prune any exception whose root cause is
    // `Destructible.Error` with a `code` of `'destroyed'`. This could be
    // immutable, returning a new exception, so we can log the original
    // exception, then log a pruned excpetion. Ideally we'd be able to do this
    // after the fact.
    //
    // At times I see mass scrams, meaning I'm not shutting down correctly,
    // which I imagine in a server with thousands of sockets that fail to close
    // would be unreadable and possibly unreportable. This suggests a
    // de-duplification prune that would remove exceptions that have the same
    // `id` path and exception type and code. Give me an idea for using codes
    // and prefixes and sprintf to report errors.

    //
    rescue (...vargs) {
        const f = vargs.pop()
        return (async () => {
            try {
                return await (typeof f == 'function' ? f() : f)
            } catch (error) {
                if (error.instance !== this._properties.instance) {
                    this.destroy()
                    throw error
                }
            }
        }) ()
    }
}

module.exports = Destructible
