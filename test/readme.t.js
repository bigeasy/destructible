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
require('proof')(48, async okay => {
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
        await destructible.destroy().promise
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
        await destructible.destroy().promise

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

        await destructible.destroy().promise
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
            await destructible.promise
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
            await destructible.promise
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
        okay(destructible.isDeferrable, 'root is always a counted destructible')

        const countdown = destructible.terminal('countdown', 1)
        okay(countdown.countdown, 1, 'initial countdown')
        okay(countdown.isDeferrable, 'is a counted destructible')

        destructible.destroy()

        okay(countdown.countdown, 1, 'countdown unchanged')

        okay(!countdown.destroyed, 'countdown not destroyed')
        okay(destructible.destroyed, 'destructible is destroyed')

        const ran = await countdown.exceptional('run', async () => 1)

        okay(ran, 1, 'can still run new strands on countdown')

        countdown.decrement()

        okay(countdown.destroyed, 'countdown is now destroyed')

        await destructible.promise
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

    // Destructible creates a destructible tree. The branches of the tree are
    // destructible objects. The leaves of the tree are promises.

    // Ordinarily, a rejected promise in a sub-destructible will be gathered
    // into the `Destructible.promise` property of ...

    // **TODO** Ready to rename it again. Maybe `promise` and `done`.

    // ... as part of a nested exception of all errors. `exceptional` will
    // will both ...

    // **TODO** Maybe exceptional will throw the exception, crash the program,
    // but not report it assuming that it is going to get reported somewhere
    // else? Yes, but you need to have an exception to report, it would have to
    // be an exception that said, hey, something bad happened, but someone else
    // is going to report it. Really, you should not allow exceptions to slip
    // out of destructible. You're finding that initialization is separate.

    // **TODO** Also, you need some sort of recoverable. It will receive the
    // shutdown message and be part of scram, it is basically an ephemeral that
    // both resolves and rejects.

    // ... report the exception through the funnel exception, but it will also
    // throw the exception.

    //
    {
    }
    //

    // When we discuss how to use destructible tree we have to have some terms
    // to describe the actors on the destructible tree.

    // We are going to call the enviornment in which our destructible tree
    // exists our _application_. The application might represent the entire
    // process where the desturction of the destructible tree means the program
    // is over, but Destructible is not a per process module.

    // The destructible tree can be short lived. Ultimately it is just a single
    // promise you resolve. It might represent a complex module like a network
    // server where the destruction of the destructible tree means the server
    // has stopped listening. The complex module can simply return the root
    // `Destructible.promise` to the module client who doesn't know or care that
    // they're listening to a destructible tree.

    // A destructible in the destructible tree it not itself an actor, athough
    // when you read the code it may look like one. When you define strands and
    // destructors using anonymous functions, it gives the appearance that the
    // destructible is doing a lot of work. It's not. It's merely monitoring the
    // work in the case of strands, and triggering callbacks in the case of
    // destructors.

    // It's like `EventEmitter` in that way. Even more so, since you can derrive
    // a class from `EventEmitter` but not `Destructible`. `Destructible` is all
    // about composition.

    // When we describe an actor we will call it a _service_. These are services
    // that other services depend on to function, so they cannot be destroyed
    // until their dependent services are destroyed. We are going to call a
    // dependent service a _client service_ and the service it depnds on a
    // _common service_.

    // Our convention for a common service is to create a deferrable
    // destructible and expose it on our common service as a `deferrable`
    // property while exposing the parent of the deferrable destructible as a
    // `destructible` property.

    // We register a destructor on our `destructible` destructible that will
    // wait for work to finish then decrement the countdown of the `deferrable`
    // destructible. The `deferrable` destructible will contain the destructible
    // tree with the strands that do the real work of the common service.

    // We expose these properties so that client services can opt to keep our
    // service operational during shutdown. A client service will increment the
    // countdown of the `deferrable` destructible of the common service and
    // register a destructor that will make use of the service before
    // decrementing that same countdown.

    // If this service is a work queue, client services may want to enqueue a
    // cleanup procedure. If they are unable to defer

    // With this convention we've established a method for staged shutdown.

    // Stages are defined by boundaries in the destructible tree. Stage
    // bondaries occur when a destructible is either deferred or ephemeral.

    // We think about these boundaries in these terms; if this this destructible
    // destroyed if that destructible is destroyed? Will calling `destroy()` on
    // that destructible cause this destructible to be destroyed _immediately_
    // with the same synchronous destruct chain invocation?

    // **TODO** What is one destructible calling another? It is not the
    // destructible called by the process group, or the keeper of the
    // destructible. Maybe we clarify in a preamble.

    // We use `Destructible.isDestroyedIfDestroyed(destructible)` to answer this
    // question.

    //
    {
        const parent = new Destructible('parent')
        const child = parent.durable('child', 1)

        okay(!parent.isDestroyedIfDestroyed(child), 'parent is not destroyed by child destruction due to deferrable boundary')
        okay(!child.isDestroyedIfDestroyed(parent), 'child is not destroyed by parent destruction due to deferrable boundary')

        parent.destroy()
        child.decrement()

        await parent.promise
    }
    //

    // We need to know this in order to build services that want to increment
    // the countdown of a defferred destructible of another service. The client
    // service needs to be certain that it will be destroyed by the same
    // destruct call as the destructible that ...

    // We want to know that if a deferred destructible is destroyed, that a
    // destructible that incremented the countdown of the deferred destructble
    // on will be immediately destroyed so it can work toward decrementing the
    // countdown and shutting down the destructible tree.

    // When a destructible is dife

    // A deferrable destructible creates a stage boundary.

    // A deferrable destructible creates a stage boundary. All the descendents
    // of that destructible that are not themselves counted destructibles are
    // part of the same stage. There are times when you will want to ensure that
    // two destructibles are part of the same stage. This is actually an
    // important part of managing our staged shutdown conventions. For this we
    // have a an `isSameStage()` method.

    //
    {
        const destructible = new Destructible('root')

        const first = destructible.durable('first')
        const second = destructible.durable('second')
        const third = second.durable('third')

        const deferrable = first.durable('deferrable', 1)
        const fourth = deferrable.durable('fourth')

        okay(first.isDestroyedIfDestroyed(third), 'will shutdown at the same time')
        okay(!fourth.isDestroyedIfDestroyed(third), 'will not shutdown at the same time')

        okay(deferrable.isDestroyedIfDestroyed(fourth), 'parent and child in same stage')
        okay(fourth.isDestroyedIfDestroyed(deferrable), 'child and parent in same stage')

        okay(!first.isDestroyedIfDestroyed(deferrable), 'parent and child not in same stage')
        okay(!deferrable.isDestroyedIfDestroyed(first), 'child and parent not in same stage')

        okay(deferrable.isDestroyedIfDestroyed(deferrable), 'counted in same stage as self')
        okay(third.isDestroyedIfDestroyed(third), 'uncounted in same stage as self')

        destructible.destroy()
        deferrable.decrement()

        await destructible.promise
    }
    //

    // **TODO** Remove the funny argument handling and simply have a `counted`
    // constructor, oh, wait. You can have deferrable ephemerals and deferrable
    // durables and deferrable anything.

    // Ephemeral destructible also create a stage boundary. Unlike the
    // deferrable boundaries, the boundary is not transative.

    // A destruct message from the root will be received by both an ephemeral
    // destructible and its parent.

    // When you call destroy on an ephemeral's parent, the ephemeral will
    // receive the same destruct message. When you call destroy on an ephemeral,
    // the ephemeral's parent will not receive the destruct message.

    // When you call destroy on a deferrable's parent, the deferrable will not
    // receive the same destruct message. When you call destroy on a
    // deferrable, the deferrable's parent will not receive the destruct
    // message.

    // A child will receive the same destruct message as a parent. A parent will
    // not

    // Ephemeral and exceptional Destructilbles also create a stage boundary,
    // but this boundary is not transitive. Unlike a countdown, an ephemeral and
    // a durable will both receive a destruct message from the root. If an
    // ephemeral depends on being notified when a durable is notified they are

    // They are both ephemeral in that they can both exit before their parent
    // Destructible exists.

    // If you have a Destructible with an ephemeral child and a durable child
    // and you initiate a destroy from the parent, the destruct message will
    // immediately cross ephemeral bounaries, both the ephemeral child and the
    // durable child will destruct, so they are in the same stage from the root
    // to the leaves, but because you can also initate a destroy on the
    // ephemeral alone the durable will not destruct so we cannot say that they
    // are always in the same stage. For our purposes and practical applicatoins
    // not always is as good as not at all.

    //
    {
        const parent = new Destructible('parent')
        const child = parent.ephemeral('child')

        okay(!parent.isDestroyedIfDestroyed(child), 'durable and ephemeral siblings not in same stage')
        okay(child.isDestroyedIfDestroyed(parent), 'ephemral and durable siblings not in same stage')
    }

    {
        const destructible = new Destructible('parent')

        const first = destructible.durable('first')
        const second = destructible.ephemeral('second')

        okay(!first.isDestroyedIfDestroyed(second), 'durable sibling not in same stage as ephemeral sibling')
        okay(second.isDestroyedIfDestroyed(first), 'ephemeral sibling in same stage as durable sibling')

        okay(!destructible.isDestroyedIfDestroyed(second), 'child ephemeral not in same stage as parent')
        okay(second.isDestroyedIfDestroyed(destructible), 'parent in same stage as child ephemeral')

        const third = destructible.durable('third')
        okay(third.isDestroyedIfDestroyed(first), 'durable siblings in same stage')

        const fourth = second.durable('fourth')
        okay(second.isDestroyedIfDestroyed(fourth), 'durable child in same stage as ephemeral parent')

        const fifth = second.ephemeral('fifth')
        okay(!second.isDestroyedIfDestroyed(fifth), 'ephemeral child not in same stage as ephemeral parent')
        okay(fifth.isDestroyedIfDestroyed(second), 'ephemeral parent in same stage as ephemeral child')
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
            this.deferrable = destructible.durable('deferrable', 1)
            this.deferrable.durable('queue', async () => {
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
            this.deferrable.destruct(() => {
                this.terminated = true
                this._notify.call()
            })
            this.destructible.destruct(() => {
                this.destructible.ephemeral('shutdown', async () => {
                    await this.drain()
                    this.deferrable.decrement()
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
    // of **TODO** No! 2 to process the work queue queue. When it gets a
    // destruct message the countdown will be automatically decremented once by
    // the parent. There will still be one decrement to go before the
    // `countdown` Destructible is destroyed.

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
        okay(!queue.deferrable.destroyed, 'countdown is not destroyed')

        await destructible.promise

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

        assert(destructible.isDestroyedIfDestroyed(queue.destructible))

        queue.deferrable.increment()
        destructible.destruct(() => {
            queue.enqueue(async () => gathered.push('done'))
            queue.deferrable.decrement()
        })

        const gathered = []
        for (const value of [ 'working', 'working' ]) {
            queue.enqueue(async () => gathered.push(value))
        }

        destructible.destroy()

        okay(!queue.terminated, 'queue is still operational')

        okay(queue.destructible.destroyed, 'destructible is destoryed')
        okay(!queue.deferrable.destroyed, 'deferrable is not destroyed')

        await destructible.promise

        okay(queue.terminated, 'queue is has completely shutdown')

        okay(gathered, [ 'working', 'working', 'done' ], 'pushed final work onto queue')
    }
})
