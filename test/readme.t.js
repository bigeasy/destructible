// # Destructible
//
// This readme document is a unit test from the Destructible source code. It
// uses the [Proof](https://github.com/bigeasy/proof) unit test framework. We'll
// be using the `okay` method from Proof to assert the points we make about
// Destructible.
//
// Please run this test yourself.
//
// ```text
// git clone git@github.com:bigeasy/destructible.git
// cd destructible
// npm install --no-package-lock --no-save
// node test/readme.t.js
// ```
//
// Our unit test begins here.

//
require('proof')(36, async okay => {
    // In your program this would be
    //
    // ```javascript
    // const Destructible = require('destructible')
    // ```
    //
    // But we'll be running this as a unit test as part of CI/CD to ensure that
    // this readme doesn't get out of date.

    //
    const Destructible = require('..')
    //

    // We'll be using these anoymous blocks so we can show declarations that
    // should use `const` each time we illustrate a point. Without them we'd
    // have have to use varaiable names like `destructible2`, `destructible3`.

    //
    {
        const destructible = new Destructible('example')
        await destructible.destroy().rejected
    }

    // If you're wondering what just happened, we created an instance of
    // `Destructible`, immediately destroyed and then waited for the funnel
    // promise to resolve or reject. Let's look at that again and look at a few
    // of the properties of `Destructible` while we're at it.
    //
    // When you create a destructible, you give it an identifier. This will
    // become a property of the `Destructible`.
    //
    // The `destroy()` method destroys the `Destructible` and then returns the
    // `Destructible` so you can perform the common action of destroying and
    // awaiting the result as a one-liner.

    //
    {
        // Construct a destructible with an `id` of `'example'`.
        const destructible = new Destructible('example')

        // Look at some of the properties of the `Destructible`.
        okay(destructible.id, 'example', 'destructible id has been set')
        okay(!destructible.destroyed, 'destructible has not been destroyed')

        // Destroy the `Destructible` and await its funnel `Promise`.
        await destructible.destroy().rejected

        // The destructible is now `destroyed`.
        okay(destructible.destroyed, 'destructible has been destroyed')
    }

    // Let's do some work with a `Destructible`.

    //
    {
        const destructible = new Destructible('example')

        destructible.durable('loop', async () => {
            while (!destructible.destroyed) {
                console.log('loop')
                await new Promise(resolve => setTimeout(resolve, 50))
            }
        })

        await new Promise(resolve => setTimeout(resolve, 250))

        await destructible.destroy().rejected
    }
    //

    // We created a destructible and created `durable` strand. A `durable`
    // strand will run for the lifetime of the Destructible. If it returns early
    // the Destructible will raise an exception.

    // An exception looks like this. You can view the generated stack trace by
    // running this unit test.

    //
    {
        const destructible = new Destructible('example')

        destructible.durable('errored', async () => {
            throw new Error('thrown')
        })

        try {
            await destructible.rejected
        } catch (error) {
            okay(error instanceof Destructible.Error, 'destructible wraps exceptions of strands')
            okay(error.errors[0] instanceof Destructible.Error, 'strands wrap exceptions thrown by the Promise they monitor')
            okay(error.errors[0].errors[0].message, 'thrown', 'actual exception')
            console.log('\n--- Destructible exception ---\n')
            console.log(`${error.stack}\n`)
        }
    }
    //

    // As noted, when you end a `durable` strand early, that will raise an
    // exception.

    //
    {
        const destructible = new Destructible('example')

        destructible.durable('early', async () => {})

        try {
            await destructible.rejected
        } catch (error) {
            okay(error instanceof Destructible.Error, 'destructible wraps exceptions of strands')
            okay(error.errors[0] instanceof Destructible.Error, 'strands raised an early exit error')
            // **TODO** Maybe DURABLE_EXIT or EARLY_EXIT something.
            okay(error.errors[0].code, 'DURABLE', 'code indicates an early exit')
            console.log('\n--- Destructible early exit exception ---\n')
            console.log(`${error.stack}\n`)
        }
    }
    //

    // We use a `durable` strand to indicate that the strand should run the
    // lifetime of the parent Destructible. If the strand returns before the
    // parent Destructible`s `destroyed` property is `true` it will raise an
    // exception.

    // Here is how you would exit a `durable` strand propery, you would use the
    // `destroyed` property as a condition to stop performing work and resolve
    // the Promise.

    //
    {
    }
    //

    // Sub-destructibles...

    //
    {
    }
    //

    // Note that the argument after the id must be a `Promise`, a function or an
    // integer greater than zero to indicated a counted Destructible which we
    // discuss in Staged Shutdown. That argument is optional, so you can give
    // nothing at all.

    // Any other type will raise an exception.
    {
        const destructible = new Destructible('example')

        try {
            destructible.durable('terrible', 'completely unexpected type')
        } catch (error) {
            okay(error.code, 'INVALID_ARGUMENT', 'invalid argument to create a durable strand')
        }
    }
    //

    // # Staged Shutdown

    // Preamble here...

    // To implement staged construction we use the increment and decrement
    // interface of Destructible. Destructible has an internal counter. When the
    // counter reaches zero destruction is initiated. When you created a
    // Destructible the counter is already set to one. Automatic shutdown is
    // performed internally by decrementing the counter.

    // If you increment the encounter exterinally, automatic shutdown is
    // defeated. You will have to decrement the counter externally.

    // To perform a staged shutdown you would create a destructible with a child
    // that that performs all the real work. The child will have its countdown
    // incremented externally. When the parent gets destroyed it starts an
    // ephemeral strand that will wait for the work in the child to finish, then
    // decrement the child's counter so it will shutdown. This is how you
    // perform a staged shutdown.

    // **TODO** We will have introduced the use in classes above.

    // There is a convention in classes that want to expose a staged shutdown,
    // and we are going to implement a `Queue` class as if we want out staged
    // shutdown to be exposed. **TODO** No, implement it enclosed first.

    // Some classes will want to expose their staged shutdown to give users say
    // in when the class has completed shutdown. Our `Queue` class above, for
    // example, may want to allow users to decide when the queue is finished.
    // They may have to put a shutdown procedure into the work queue. If they
    // have no way of holding the queue open, they are in a race to see if they
    // can enqueue their shutdown procedure before the queue drains and refuses
    // to accept more work.

    // By convention we expose our `countdown` destructible so the user can
    // increment and decrement the counter. We also expose a `destructible` that
    // will be destroyed synchronously when the root destructible is called.
    // Rather than exposing destructible used to create the queue we create a
    // new sub-destructible so that the exposed destructible has a clean
    // namespace. For exampe, the user can may a `'shutown'` stand. We create a
    // sub-destructible so that an error from the users `'shutdown'` strand can
    // be more easily distinquished from the `'shutdown'` strand or our `Queue`
    // class.

    // **TODO** Probably need a preamble about namespaces.

    // **TODO** And we show just that in a code example.

    // We can extend this convention a bit further and create a countdownable
    // class. A countdownable class has a `destructible` and `countdown`
    // Destructible and an object called `counted`. The `counted` object
    // contains named properties that describe the counted object.

    // Now you can create a `Destructible.Counter` using the static
    // `Destructible.counter`. `Destructible.Counter` has a `destructible`
    // property which is a sub-destructible of `destructible`, a `countdown`
    // property which is the countdown of the counted object, and a `counted`
    // property. That `counted` property can be deferenced or destructured to
    // receive an instance of the actual counted object.

    // The `Destructible.Counter` it itself a counted object, so you can create
    // sub-destructibles using it.

    // Now that we have a con

    // Here is a class that would like to shut down in stages. It is a work
    // queue. When it gets a destruction notice it would like to complete its
    // work before exiting.

    class Queue {
        // Gone.
    }
    //

    // Examples go here.

    // The Queue class implement a duck-type interface that we're going to
    // establish as a convention for staged shutdowns. Any class that wants to
    // advertise a staged shutdown should expose the `destructible` given to the
    // class through the constructor and a `countdown` Destructible created from
    // the `destructible` that will hold the strands that do the real work.

    // The when the `destructible` is destructed it lauches an ephemeral
    // shutdown strand that waits for the real work to finish. It then
    // decrements the counter on the `countdown` so it can destruct.

    // By exposing the `countdown`, users can increment the countdown and keep
    // the class running after destruction. By exposing the `destructible`,
    // users can register their own destructor that can launch it's own
    // ephemeral shutdown strand and wait for work to finish.

    // This is, admittedly, a bit complex, but we have an example here, we ought
    // to be able to illustrate this.

    // Because this is a convention, we've created a static
    // `Destructible.countdown()` method that returns an instance of
    // `Destructible.Countdown`.

    //
    {
        // Gone. Kept text in case there's something in it worth saving.
    }


    // ## Staged Destruction Redux

    // We implement staged destruction using destructibles that have a countdown
    // enabled. To create a countdown enabled destructible you invoke one of the
    // constructor members with the usual optional trace function and key and an
    // integer argument of one or more. This integer argument is the initial
    // countdown.

    // Here we create a terminal destructor named `countdown` that will shutdown
    // the parent when it exist. We when run a terminal strand that
    // automatically shuts down the `countdown` constructor but both `countdown`
    // and `destructible` remain active.

    // Only when we further decrement the countdown to zero do we destroy the
    // destructible tree of strands.

    //
    {
        const destructible = new Destructible('root')
        okay(!destructible.counted, 'is not a counted destructible')

        const countdown = destructible.terminal('countdown', 2)
        okay(countdown.countdown, 2, 'initial countdown')
        okay(countdown.counted, 'is a counted destructible')

        destructible.destroy()

        okay(countdown.countdown, 1, 'auto decrement initiated')

        okay(!countdown.destroyed, 'countdown not destroyed')
        okay(destructible.destroyed, 'destructible is destroyed')

        const ran = await countdown.exceptional('run', async () => 1)

        okay(ran, 1, 'can still run new strands on countdown')

        countdown.decrement()

        okay(countdown.destroyed, 'countdown is now destroyed')

        await destructible.rejected
    }
    //

    // The `increment` property only works with a counted `Destructible`. The
    // `decrement` method works on all `Destructible`s but if they are not
    // counted the default countdown is `1` so calling `decrement` is the same
    // as calling `destroy`.

    // Note that `destroy` still works with counted Destructibles and will
    // initiate a shutdown regardless of the countdown.

    //
    {
    }
    //

    // A counted Destructbile creates a stage boundary. All the descendents of
    // that Destructible that are not themselves counted Destructibles are part
    // of the same stage. There are times when you will want to ensure that two
    // destructibles are part of the same stage. This is actually an important
    // part of managing our staged shutdown conventions. For this we have a an
    // `isSameStage()` method.

    //
    {
        const destructible = new Destructible('root')

        const first = destructible.durable('first')
        const second = destructible.durable('second')
        const third = second.durable('third')

        const counted = first.durable('counted', 1)
        const fourth = counted.durable('fourth')

        okay(first.isSameStage(third), 'will shutdown at the same time')
        okay(!fourth.isSameStage(third), 'will not shutdown at the same time')

        okay(counted.isSameStage(fourth), 'parent and child in same stage')
        okay(fourth.isSameStage(counted), 'child and parent in same stage')

        okay(!first.isSameStage(counted), 'parent and child not in same stage')
        okay(!counted.isSameStage(first), 'child and parent not in same stage')

        okay(counted.isSameStage(counted), 'counted in same stage as self')
        okay(third.isSameStage(third), 'uncounted in same stage as self')

        destructible.destroy()

        await destructible.rejected
    }
    //

    // So, stages are defined by this counted Destructible boundaries. How would
    // we use them?

    // Let's create a queue that is uses destructible to defer shutdown. It will
    // recieve a destroy message, but it will process contents of the queue
    // before completing.

    //
    class StagedShutdownQueue {
        constructor (destructible) {
            this._notify = () => {}
            this._queue = []
            this.destructible = destructible
            this.countdown = destructible.durable('countdown', 2)
            this.countdown.durable('queue', async () => {
                for (;;) {
                    if (this.terminated) {
                        break
                    }
                    if (this._queue.length == 0) {
                        if (this._drain != null) {
                            this._drain.resolve.call()
                            this._drain = null
                        }
                        await new Promise(resolve => this._notify = resolve)
                        continue
                    }
                    await this._queue.shift().call()
                }
            })
            this.countdown.destruct(() => {
                this.terminated = true
                this._notify.call()
            })
            this.destructible.destruct(() => {
                this.destructible.ephemeral('shutdown', async () => {
                    await this.drain()
                    this.countdown.decrement()
                })
            })
        }

        async drain () {
            if (this._queue.length != 0) {
                if (this._drain == null) {
                    let capture
                    this._drain = { promise: new Promise(resolve => capture = { resolve }), ...capture }
                }
                await this._drain.promise
            }
        }

        enqueue (work) {
            if (this.terminated) {
                throw new Error('terminated')
            }
            this._queue.push(work)
            this._notify.call()
        }
    }
    //

    // Our staged shutdown queue creates a counted Destructible with a countdown
    // of 2 to process the work queue queue. When it gets a destruct message the
    // countdown will be automatically decremented once by the parent. There
    // will still be one decrement to go before the `countdown` Destructible is
    // destroyed.

    // When the queue gets a destruct message from the given destructible is
    // starts an ephemeral shutdown strand that will wait for the queue to
    // drain then decrement the countdown in the `countdown` Destructible.

    //
    {
        const destructible = new Destructible($ => $(), 'root')

        const queue = new StagedShutdownQueue(destructible.durable($ => $(), 'queue'))

        const gathered = []
        for (const value of [ 1, 2, 3, 4 ]) {
            queue.enqueue(async () => gathered.push(value))
        }

        destructible.destroy()

        okay(!queue.terminated, 'queue is still operational')

        queue.enqueue(async () => gathered.push(5))

        okay(queue.destructible.destroyed, 'destructible is destoryed')
        okay(!queue.countdown.destroyed, 'countdown is not destroyed')

        await destructible.rejected

        okay(queue.terminated, 'queue is has completely shutdown')

        okay(gathered, [ 1, 2, 3, 4, 5 ], 'all work processed')
    }

    // This is another example of a Destructible-based service. We follow the
    // convention of exposing the destructible and now this exposure makes a
    // little more sense.

    // We have a new convention for services that provide a staged shutdown. We
    // create a counted Destructable that does the real work of the service and
    // expose it as a `countdown`.

    // Users of the service can assert that the Destructible of the service and
    // a destructible outside the service are in the same stage. If they are,
    // they know that the service will begin shutdown at the same time as any
    // destructors they register on their external Destructible. They can then
    // increment the `countdown` to hold the service open and register a
    // destructor that will finalize their use of the service before
    // decrementing the `countdown` to release their hold on the service's
    // shutdown.

    //
    {
        const assert = require('assert')
        const destructible = new Destructible($ => $(), 'root')

        const queue = new StagedShutdownQueue(destructible.durable($ => $(), 'queue'))

        assert(destructible.isSameStage(queue.destructible))

        queue.countdown.increment()
        destructible.destruct(() => {
            queue.enqueue(async () => gathered.push('done'))
            queue.countdown.decrement()
        })

        const gathered = []
        for (const value of [ 'working', 'working' ]) {
            queue.enqueue(async () => gathered.push(value))
        }

        destructible.destroy()

        okay(!queue.terminated, 'queue is still operational')

        okay(queue.destructible.destroyed, 'destructible is destoryed')
        okay(!queue.countdown.destroyed, 'countdown is not destroyed')

        await destructible.rejected

        okay(queue.terminated, 'queue is has completely shutdown')

        okay(gathered, [ 'working', 'working', 'done' ], 'pushed final work onto queue')
    }
})
