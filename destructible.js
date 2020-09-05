// Node.js API.
const assert = require('assert')

// Exceptions that you can catch by type.
const Interrupt = require('interrupt')

// A linked-list to track promises, scrams.
const List = require('./list')

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
    static Error = Interrupt.create('Destructible.Error')

    static Destroyed = Interrupt.create('Destructible.Destroyed', Destructible.Error)

    // `new Destructible([ scram ], key, ...context)` constructs a new
    // `Destructible` that will scram after the given `scram` timeout or the
    // default `1000` milliseconds if not given. The key is used to report the
    // `Destructible` in the stack trace on error or scram. The `context` is
    // used to provide further context to the error stack trace for debugging.
    constructor (...vargs) {
        this._timeout = typeof vargs[0] == 'number' ? vargs.shift() : 1000
        this._ephemeral = true
        this.key = vargs.shift()
        this.context = vargs

        this.destroyed = false

        this.destructed = new Promise((...vargs) => this._destructed = vargs)

        this._parent = null

        this._waiting = new List

        this._increment = 0

        this._scrammable = new List

        this._errors = []

        this._errored = false

        this._destructing = false

        this._destructors = []
        // Yes, we still need `Signal` because `Promise`s are not cancelable.
        this._scrams = new List

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
    clear (handle) {
        if (typeof handle[Symbol.iterator] == 'function') {
            for (const _handle of handle) {
                this.clear(_handle)
            }
        } else {
            const index = this._destructors.indexOf(handle)
            if (~index) {
                return this._destructors.splice(index, 1).shift()
            }
        }
    }

    //

    // Internal method for processing the return value when either all monitored
    // promises have resolved or the shutdown failed to complete before the
    // scram timeout.
    _return () {
        if (!this._waiting.empty) {
            this._destructed[1].call(null, new Destructible.Error('scrammed', this._errors, {
                key: this.key,
                context: this.context,
                waiting: this._waiting.slice(),
                code: 'scrammed'
            }))
        } else if (this._errors.length != 0) {
            this._destructed[1].call(null, new Destructible.Error('error', this._errors, {
                key: this.key,
                context: this.context,
                waiting: this._waiting.slice(),
                code: 'errored'
            }))
        } else {
            this._destructed[0].call(null, true)
        }
    }

    // Temporary function to ensure noone is using the cause property.
    get cause () {
        throw new Error
    }

    operational () {
        if (this.destroyed) {
            throw new Destructible.Destroyed('destroyed', { code: 'destroyed' })
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
    // At the time of writing this comment, we've just added the `working()`
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
    // With the `working()` function a timeout is based on progress, or not if
    // you never call `working()`. Each socket will call working as it performs
    // the steps in its handshake indicating that it making progress.

    //
    async _scrammed () {
        if (this._ephemeral) {
            const scram = { timeout: null, resolve: null }
            this._scrams.push(() => {
                clearTimeout(scram.timeout)
                scram.resolve.call()
            })
            this._working = true
            while (this._working) {
                this._working = false
                await new Promise(resolve => {
                    scram.resolve = resolve
                    scram.timeout = setTimeout(resolve, this._timeout)
                })
            }
            this._scram()
        } else {
            await new Promise(resolve => this._scrams.push(resolve))
        }

        // Wait for any scrammable promises. Reducing the list is
        // performed on the resolution side.
        while (!this._scrammable.empty) {
            await this._scrammable.peek()
        }

        // Calcuate the resolution of this `Destructible`.
        this._return()
    }

    // This is our internal destroy. We run it as an async function which
    // creates a new strand of execution. Nowhere do we wait on the promise
    // returned by executing this function nor should we. It is fire and forget.
    // Hung or rejected child promises are reported through an `Interrupt`
    // generated error through the `Destructible.promise`.

    //
    _destroy () {
        // If we've not yet been destroyed, let's start the shutdown.
        if (!this.destroyed) {
            this.destroyed = true
            // Run our destructors.
            //
            // We may want to make `Destructors` synchronous, however, and
            // insist that if they must do something async that they use an
            // ephemeral, since we are not going to actually get to the scram
            // part until the destructors are done. We set `_destructing` flag
            // that allows us to create an `ephemeral`, but only for the
            // synchronous duration of the destructor function.
            this._destructing = true
            while (this._destructors.length != 0) {
                try {
                    this._destructors.shift().call()
                } catch (error) {
                    this._errors.push([ error, { method: 'destroy' } ])
                }
            }
            this._destructing = false
            // If we're complete, we can resolve the `Destructible.promise`,
            // otherwise we need to start and wait for the scram timer.
            if (this._complete()) {
                this._return()
            } else {
                // Push something into the scram list immediately, but it
                // shouldn't matter because the async call should run
                // synchronously until it awaits, but I'm too lazy to go and
                // confirm this and this is fine.
                this._scrammed()
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
        // TODO New stuff, come back and rewrite when it's old stuff. We get
        // told to scram, but we've not destroyed. That means that someone
        // created a child destructible that they needed to stay alive after the
        // parent is destroyed — the parent can write to services in the child
        // that would attempt to create a new `ephemeral` and error.
        //
        // Now that `_destroy` is synchronous, when we call it, it will call
        // destroy on all children and it will synchronously build a scram chain
        // so that the next call to run our scrams will propagate scrams.
        if (!this.destroyed) {
            this._destroy()
        }
        while (!this._scrams.empty) {
            this._scrams.shift()()
        }
    }

    //

    // Check to see if this `Destructible` has completed its shutdown
    // if it is destroyed. If the destructible has completed shutdown stop the
    // scram timer and toggle the scram timer latch.
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
    // ```
    // const result = {
    //     first: await destructble('first', this._first()),
    //     second: await destructible('second', this._second()),
    // }
    // await destructible.destructed
    // return result
    // ```
    //
    // How is that any different? Not the result of `destructed`, but still.

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

    async _awaitPromise (operation, wait, vargs) {
        try {
            try {
                return await operation
            } finally {
                this._waiting.unlink(wait)
            }
        } catch (error) {
            this._errored = true
            this._errors.push([ error, wait.value ])
            this._destroy()
            if (vargs.length != 0 && vargs[0] === true) {
                throw new Destructible.Destroyed('destroyed', { code: 'destroyed' })
            }
        } finally {
            if (wait.value.method == 'durable') {
                this._destroy()
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
    // TODO We're going to have race conditions if we do not push the scrammable
    // in the same synchronous run in which we check destroyed.
    async _awaitScrammable (destructible, wait, scram) {
        // Monitor our new destructible as child of this destructible.
        const scrammable = {}
        const node = this._scrammable.push(new Promise(resolve => scrammable.resolve = resolve))
        try {
            await this._awaitPromise(destructible.destructed, wait, [])
        } finally {
            // TODO Much better as a linked list, right? `_scrame` may have
            // shifted scram, maybe it should just `for` over them? No, bad
            // because here we're splicing. A linked list is so much better.
            //
            // TODO Convince yourself that it doens't matter if you call a
            // scrammable before you call `_complete`.
            this._scrams.unlink(scram)
            this._scrammable.unlink(node)
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
    _await (method, key, vargs) {
        if (!(method == 'ephemeral' && this._destructing)) {
            this.operational()
        }
        const wait = this._waiting.push({ method, key })
        // Ephemeral destructible children can set a scram timeout.
        if (typeof vargs[0] == 'function') {
            //const promise = async function () { return await vargs.shift()() } ()
            return this._awaitPromise(vargs.shift()(), wait, vargs)
        } else if (vargs.length == 0) {
            // Ephemeral sub-destructibles can have their own timeout and scram
            // timer, durable sub-destructibles are scrammed by their root.
            //assert(typeof vargs[0] != 'number')
            // Create the child destructible.
            //assert(typeof this._timeout == 'number' && this._timeout != Infinity)

            const destructible = new Destructible(this._timeout, key)

            destructible.increment()

            // Destroy the child destructible when we are destroyed.
            const destruct = this.destruct(() => {
                destructible._ephemeral = false
                destructible.decrement()
            })

            if (method == 'ephemeral') {
                destructible._ephemeral = true
            }

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
                if (method == 'durable' || destructible._errored) {
                    this._errored = this._errored || destructible._errored
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
            const scram = this._scrams.push(() => {
                destructible._scram()
            })

            // This is added at a late date to propagate the working flag. Until
            // now, all parent/child communication was done through generalized
            // structures so that the parent or child was just another consumer
            // of child or parent services respectively. Temptation is to
            // rethink whether this should be the case or if more parent/child
            // interation should be explicit, but rather than give it a lof
            // thought, I'm going to assume that if I did, I'd realize that this
            // is the way it's supposed to be.
            destructible._parent = this

            this._awaitScrammable(destructible, wait, scram)

            return destructible
        } else {
            return this._awaitPromise(vargs.shift(), wait, vargs)
        }
    }

    working () {
        if (this.destroyed) {
            this._working = true
            if (this._parent != null) {
                this._parent.working()
            }
        }
    }

    // Launch an operation that lasts the lifetime of the `Destructible`. When
    // the promise resolves or rejects we perform an orderly shutdown of the
    // `Destructible`.

    //
    durable (key, ...vargs) {
        return this._await('durable', key, vargs)
    }

    // Launch an operation that does not last the lifetime of the
    // `Destructible`. Only if the promise rejects do we perform an orderly
    // shutdown of the `Destructible`.

    //
    ephemeral (key, ...vargs) {
        return this._await('ephemeral', key, vargs)
    }

    // Used the configuration problem I keep encountering. The problem is that
    // we're trying to setup a bunch of sub-destructibles, but we encounter an
    // error that means we have to stop before setup is completed. We'd like to
    // stop making progress on our setup, but we also want to report the error,
    // and it would be nice if it was all wrapped up in
    // `Destructible.destructed`. So, we run setup function in `attemptable` and
    // we run the possibly abortive configuration step in `awaitable`.
    //
    // Actually a more general problem. With Destructible I tend to run
    // background strands with work queues and the like. The work queue will
    // report the real error, but somewhere someone is waiting and they need an
    // exception to prevent progress. I don't want both exceptions reported. The
    // caller should get an exception to indicate that the system is shutdown,
    // but not the details of the shutdown, that would be reported through
    // `Destructible.destructed`.

    //
    static destroyed (error) {
        if (!(error instanceof Destructible.Destroyed)) {
            throw error
        }
    }

    static async rescue (f) {
        try {
            await f()
        } catch (error) {
            Destructible.destroyed(error)
        }
    }
}

module.exports = Destructible
