// Node.js API.
const assert = require('assert')

// Exceptions that you can catch by type.
const Interrupt = require('interrupt')

// A Promise wrapper that captures `resolve` and `reject`.
const { Future } = require('perhaps')

// A linked-list to track promises, scrams.
const List = require('./list')

// Return the first non-`null`-like value.
const { coalesce } = require('extant')

// Do nothing.
const noop = require('nop')

//

// Destructible is a class and instances form a destructible tree. The tree is
// not explicit, there is no list of children. There is a parent pointer. It is
// only used by the `isDestroyedIfDestroyed` function.

// The children are referenced using the `destruct` list and the `panic` list.
// There a list of waiting sub-destructibles, but it is a list of destructible
// ids only for reporting in the exception.

//
class Destructible {
    //

    // **TODO** Organize and prune this list.

    //
    static Error = Interrupt.create('Destructible.Error', {
        INVALID_TRACER: 'tracer must be a function that takes a single argument',
        INVALID_ARGUMENT: `
            the strand constructor argument must be a function, Promise, initial countdown, or nothing at all
        `,
        INVALID_COUNTDOWN: {
            code: 'INVALID_ARGUMENT',
            message: 'the countdown must be an integer zero or greater, got: %(_countdown)d'
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
    //

    // Constructor arguments are still in flux. Not sure that the timeout should
    // be implicit. Wondering if splat functions are technically megaporhic in
    // Google V8. Probably doesn't matter though, as Destructibles are created
    // in frequently and portend an `async` call which is going to be the
    // bottleneck. Benchmarking shows that the overhead of creating a
    // destructible for a an `async` call to an `'fs'` function is vanishingly
    // small.

    //
    constructor (...vargs) {
        const $trace = typeof vargs[0] == 'function' ? vargs.shift() : null

        const timeout = typeof vargs[0] == 'number' ? vargs.shift() : 1000

        const options = {
            $trace, timeout, ...(typeof vargs[0] == 'object' ? vargs.shift() : {})
        }

        if ($trace != null) {
            Interrupt.assertTracer($trace)
        }

        this._timeout = options.timeout

        this.id = vargs.shift()
        assert(typeof this.id == 'string')

        this.path = [ this.id ]

        this.destroyed = false

        this._ephemeral = true

        // **TODO** Where am I really using this? Starting to feel that I should
        // just use Interrupt to filter specific errors, i.e.
        // Destructible.DESTROYED, rather than try to filter then when raised.
        //
        // Any futher reflections on `rescue`, see `rescue`.
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

        this._promise = new Future

        this._parent = null

        this.durables = 0

        this.ephemerals = 0

        this._waiting = new List

        this._countdown = 0

        this.deferrable = true

        this._scrammable = new List

        this._errors = []

        // Progress is isolated by ephemeral until the parent of the ephemeral
        // destructs.
        this._progress = [ true ]

        // Error isolation is specified in a sub-destructible constuctor.
        this._isolation = { errored: false, panic: [] }

        // Used to flag whether an ephemeral can be created after construction.
        this._destructing = false

        this._destructors = new List

        this._panic = new List

        this._scrams = new List

        this._timer = Future.resolve()

        this._drain = Future.resolve()

        this._tracer = coalesce(options.tracer, { push: () => {} })

        this._cleanup = []
    }

    get promise () {
        return this._promise.promise
    }

    get countdown () {
        return this._countdown
    }

    get errored () {
        return this._isolation.errored
    }

    isDestroyedIfDestroyedIsDubious (destructible) {
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
    //

    // Not going to call the function if already destroyed/errored. Doesn't seem
    // to be the case that we're registering destructors after starup, nor
    // registering panic after startup except maybe in a destructor. Oh, you're
    // kidding me? The list of sub-destructibles is held by the list of
    // destructors. Way to go, champ.

    //
    destruct (f) {
        return this._destructors.push(f)
    }
    //

    // Panic always runs when an isolation has errored. It is used to cancel any
    // queued work and to cancel an ephemeral launched by shutdown.

    // Relatively certian that it is simple enough for an isolation. When you
    // destruct, if your isolation is errored, you work the panic list to empty
    // in `destruct` after calling, otherwise you push the panic list onto the
    // list of panic lists for the isolation. If there are any further errors
    // the catch block awaiting that promise will run the list of panic lists to
    // empty. This occurs when we destruct normally and then someone
    // subsequently errors while shutting down, easy to imagine.

    // Across isolations is where I'm stuck at the moment, just because I can't
    // get wound up about this.

    // Because I feel okay about isolation panic handling, I can use destruct
    // and panic to implement propagation.

    // Isolation means we don't panic down from the parent but we do panic up to
    // the parent. Already we don't errored down, but we do errored up.

    //
    panic (f) {
        return this._panic.push(f)
    }
    //

    // Used to return the cleared function but had no use for that in practice
    // and then added the list of handles argument which made the return
    // polymorphic so forget it. We're using lists becase we may have thousands
    // of handles to clear, do we want thousands of functions returned?

    // But we're not doing this really. We may create thousands of
    // sub-destructibles someday, but not thousands of destructors/panics.

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
        while (this._cleanup.length != 0) {
            this._cleanup.shift()()
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
    }

    // Temporary function to ensure noone is using the cause property.
    get cause () {
        throw new Error
    }

    operational (additional = true) {
        if (this.destroyed && additional) {
            throw new Destructible.Error('DESTROYED', this._properties, { path: this.path })
        }
    }
    //

    // If we are ephemeral, and the root is always ephemeral, we run a timer and
    // check for any progress that occurred while we where asleep. Applications
    // call `destructible.progress()` that sets a boolean. The boolean is shared
    // by reference by all the destructibles in an error isolation group.

    // If we are not ephemeral we add the resolve side of a promise to our list
    // of scrams and await the resolution of the promise.

    // When we are done we loop loop through our list of scrammables awaiting
    // their resolution. They are all going to resolve because either they
    // finished normally or they've just been scrammed.

    // We also have a case where we are ephemeral sub-destructible but our
    // parent has destructed. When this happens our ephemeral state changes to
    // false and our timer is resolved, so we check our ephemeral state and if
    // it is no longer ephemeral we return a call to shutdown that will perform
    // the non-ephemeral wait.

    //
    async _shutdown () {
        if (this._ephemeral) {
            assert(! this._waiting.empty)
            let timeout = null
            // We got officially scrammed. We set progress to false on the off
            // chance that it is somehow true so we don't continue to wait.
            // Defensive programming.
            this._scrams.push(() => {
                this._progress[0] = false
                clearTimeout(timeout)
                this._timer.resolve()
            })
            this._progress[0] = true
            while (! this._waiting.empty && this._progress[0]) {
                this._progress[0] = false
                this._timer = new Future
                timeout = setTimeout(() => this._timer.resolve(), this._timeout)
                await this._timer.promise
                if (! this._waiting.empty && ! this._ephemeral) {
                    return this._shutdown()
                }
            }
            this._scram()
        } else {
            const future = new Future
            this._scrams.push(() => future.resolve())
            await future.promise
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
    _destroy () {
        // If we've not yet been destroyed, let's start the shutdown.
        if (!this.destroyed) {
            //
            this.destroyed = true
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

            // If we are errored, now is the time to panic. If not we add our
            // panic list to the list of panic lists for the isolation.

            // Any ephemeral created after destruction will be isolated, it will
            // only enter the errored state if an error occurs in that sub-tree.

            //
            if (this._isolation.errored) {
                while (! this._panic.empty) {
                    this._panic.shift()()
                }
            } else {
                this._isolation.panic.push(this._panic)
            }
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
    }

    destroy () {
        this._tracer.push({ method: 'destroy', errored: this._isolation.errored, path: this.path  })
        this._countdown = 0
        this._destroy()
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
        this._tracer.push({
            method: 'increment',
            errored: this._isolation.errored,
            countdown: this._countdown,
            path: this.path
        })
        this._countdown++
    }

    decrement () {
        this._tracer.push({
            method: 'decrement',
            errored: this._isolation.errored,
            countdown: this._countdown,
            path: this.path
        })
        Destructible.Error.assert(this.deferrable, 'NOT_DEFERRABLE', { id: this.id })
        if (this._countdown == 0) {
        } else if (--this._countdown == 0) {
            this._destroy()
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
        if (! this.destroyed) {
            this._destroy()
        }
        while (! this._scrams.empty) {
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

    async _awaitPromise (operation, wait, properties) {
        const future = new Future
        try {
            try {
                return await operation
            } finally {
                List.unlink(wait)
            }
        } catch (error) {
            if (error instanceof Destructible.Error && error.symbol != Destructible.Error.DESTROYED) {
                this._errors.push(error)
            } else {
                this._errors.push(new Destructible.Error(properties, { $stack: 0 }, 'ERRORED', [ error ], wait.value))
            }
            //
            this._isolation.errored = true
            // Isolation list of panic lists is populated at destruction, so
            // this panics anything in our isolation that has already
            // destructed.
            while (this._isolation.panic.length != 0) {
                const panic = this._isolation.panic.shift()
                while (! panic.empty) {
                    panic.shift()()
                }
            }
            // This will send destruction and panic up to our ephemeral and it
            // will send it down to everyone in our isolation.
            this._tracer.push({ method: 'promise', errored: true, path: this.path })
            this._countdown = 0
            this._destroy()
            this.operational()
        } finally {
            switch (wait.value.method) {
            case 'durable': {
                    this.durables--
                    if (! this.destroyed) {
                        this._isolation.errored = true
                        this._errors.push(new Destructible.Error(properties, 'DURABLE', wait.value))
                        this._tracer.push({ method: 'durable', errored: true, path: this.path })
                        this._countdown = 0
                        this._destroy()
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
            await this._awaitPromise(destructible.promise, wait, {}).catch(noop)
        } finally {
            // TODO Convince yourself that it doens't matter if you call a
            // scrammable before you call `_complete`.
            List.unlink(scram)
            List.unlink(node)
            scrammable.resolve()
        }
    }

    _await (method, vargs) {
        if (!(this._destructing && method == 'ephemeral')) {
            this.operational()
        }
        const options = {
            $trace: typeof vargs[0] == 'function' ? vargs.shift() : null,
            timeout: typeof vargs[0] == 'number' ? vargs.shift() : this._timeout,
            ...(typeof vargs[0] == 'object' ? vargs.shift() : {}),
            id: vargs.shift()
        }
        if (options.$trace != null) {
            Interrupt.assertTracer(options.$trace)
        }
        assert(typeof options.id == 'string')
        const wait = this._waiting.push({ method, id: options.id })
        //

        // If a function, invoke it it and await the result as a promise, if no
        // arguments it is a sub-destructible, treat anything else as a promise,
        // it will get wrapped by `async` if it is not a promise already.

        //
        if (typeof vargs[0] == 'function') {
            return new Future(this._awaitPromise(vargs.shift()(), wait, { $trace: options.$trace }))
        } else if (vargs.length == 0) {
            // Construct our destructible with the options, then poke into it to
            // make it a sub-destructible.
            const destructible = new Destructible(options, options.id)

            destructible._tracer = this._tracer

            destructible.path = this.path.concat(options.id)

            // If the caller provided a countdown, we are a deferred
            // destructible.
            const deferrable = options.countdown != null
            const countdown = deferrable ? options.countdown : 0
            Destructible.Error.assert(Number.isInteger(countdown) && countdown >= 0, 'INVALID_COUNTDOWN', { _countdown: countdown })
            destructible._countdown = countdown
            destructible.deferrable = deferrable

            // Inherit the instance symbol, common to the entire destructible
            // tree.
            Object.defineProperty(destructible._properties, 'instance', Object.getOwnPropertyDescriptor(this._properties, 'instance'))

            // Set error isolation. Sub-destructibles created during `destruct`
            // are error isolated.
            if (! options.isolated && ! this._isolation.errored) {
                destructible._isolation = this._isolation
            }

            // Are we ephemeral? If so we get our own progress marker.
            destructible._ephemeral = method == 'ephemeral'
            if (destructible._ephemeral) {
                destructible._progress = [ true ]
            }
            //

            // Parent down to leaf destructor path. Destructors run
            // synchronously so all the associated state is set atomically.
            //
            // Destroy the child destructible when we are destroyed. Becasue
            // this destructible is destroyed, it or an ancestor will run a
            // shutdown timer and the child will defer to that shutdown timer.
            //
            // Even if the child is deferrable, when it destructs it is not
            // going to run its own shutdown timer so we tell it that it is no
            // longer ephemeral. Truely, it's state has switched from ephemeral
            // for durable because it will no longer be able to shutdown before
            // the parent shuts down because the parent has already shutdown.
            //
            // We do not destroy deferrables with an outstanding countdown.
            // Asking if the child's isolation is errored is akin to aksing if
            // the child is a memember of the parent's isolation. Think about
            // it.
            //
            // **TODO** Wait? We are destructing. Destruction stops at
            // deferrable boundaries not error isolation boundaries. The child
            // is still destroyed, it is just not errored.
            //
            // Gotta think use case. Database service. Server service errors so
            // all of them are panicing, shutting down as hard as possible, but
            // the database service still can perform its orderly shutdown.
            //
            // But, if the boundary is both deferrable and isolated, we don't
            // destroy it on panic.
            //
            // Ergo, if we do not destroy the child for any reason, we will
            // destory the child if we panic and the child is a member of our
            // isolation.

            //
            const downward = this.destruct(() => {
                destructible._ephemeral = false
                destructible._progress = this._progress
                if (destructible._countdown == 0 || destructible._isolation.errored) {
                    this._tracer.push({
                        method: 'downward',
                        errored: this._isolation.errored,
                        path: destructible.path
                    })
                    destructible._countdown = 0
                    destructible._destroy()
                } else if (destructible._isolation === this._isolation) {
                    const panic = this.panic(() => {
                        this._tracer.push({
                            method: 'panic',
                            errored: this._isolation.errored,
                            path: destructible.path
                        })
                        destructible._countdown = 0
                        destructible._destroy()
                    })
                    destructible._cleanup.push(() => this.clear(panic))
                }
            })
            //

            // Child up to parent destructor path.

            // If we encounter an error after destruction we want to be sure to
            // destroy the sub-destructible if it is not isolated.

            // Clear the downward destructor. If the sub-destructible is durable
            // or errored we propagate the destruction.

            // If the sub-destructible is ephemeral we register a new destructor
            // that will tell the ephemeral to surrender its scram timer and
            // allow the parent ephemeral to oversee the scram. When the timer
            // wakes it will check ephemeral before it checks progress.

            // **TODO** Is there a progress/ephemeral race? Can we set
            // destructible while at the same time calling scram for the last
            // time so that the destructible goes into wait-on-parent-scram when
            // the parent has already exited? (Doubtful. Tired.)

            // If the child is not in our isolation and it panics, we want to
            // panic. Errors and panics propagate upward.

            // If the child is not in our isolation we do not propagate our
            // panic downward. If it is in our isolation it will share our
            // panic.

            //
            destructible.destruct(() => {
                this.clear(downward)
                if (destructible._ephemeral && ! destructible._isolation.errored) {
                    const destruct = this.destruct(() => {
                        destructible._ephemeral = false
                        destructible._progress = this._progress
                        destructible._timer.resolve()
                    })
                    destructible._cleanup.push(() => this.clear(destruct))
                    if (this._isolation !== destructible._isolation) {
                        const panic = destructible.panic(() => {
                            this._isolation.errored = true
                            while (this._isolation.panic.length != 0) {
                                const panic = this._isolation.panic.shift()
                                while (! panic.empty) {
                                    panic.shift()()
                                }
                            }
                        })
                        destructible._cleanup.push(() => this.clear(panic))
                    }
                } else {
                    this._isolation.errored = this._isolation.errored || destructible._isolation.errored
                    if (! this.destroyed) {
                        if (! destructible._ephemeral && ! destructible._isolation.errored) {
                            this._isolation.errored = true
                            this._errors.push(new Destructible.Error({ $trace: options.$trace }, 'DURABLE', wait.value))
                        }
                        this._tracer.push({
                            method: 'upward',
                            errored: this._isolation.errored,
                            path: this.path
                        })
                        this._countdown = 0
                        this._destroy()
                    }
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
            return new Future(this._awaitPromise(vargs.shift(), wait, { $trace: options.$trace }))
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
}

module.exports = Destructible
