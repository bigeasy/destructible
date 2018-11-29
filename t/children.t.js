require('proof')(1, prove)

// The unusual case of constructing children but not be able to spawn the in
// serial. The constructors build objects that depend on each other. The first
// child you build waits on a promise that will deliver the second child you
// build. If you run in serial you will deadlock because you will be waiting for
// the constructor of the first child to complete before you can begin to build
// the second child, but the constructor of the first child is waiting on the
// second child to be constructed.
//
// Assuming we don't know about these dependencies ourselves, because if we did
// we'd just build things in the right order, we need to do program starts in
// parallel, catch an error from the parallel starts, and countdown the starts
// so that we know when we can return.
//
// I'm struggling with this one because it seems like you could create service
// monitor and gather up your errors in the service monitor, if any. The
// service monitor can terminate. The service destructible is used to create
// callacks to give to the constructors. The constructors are constructed using
// the applications destructible.
//
// First issue is that we're now going to timeout on the creation if they don't
// construct in time. Some of them will return destroying our ephemeral
// constructor. Any that don't are going to cause this service to be marked as
// hung. What's wrong with this exactly?
//
// You expect to be able to use the sub-destructible as a way to gather the
// constructed objects because you're able to do that from the serial
// construction.


// With the above in mind I went off to work on Olio again and I'm somewhat more
// comfortable with the parallel result. Parallel is ugly and it is going to
// rarely be used in applications. Olio is going to encapsulate heterogeneous
// tasks and divide them by process. Normal applications are going to have
// heterogeneous tasks running next to each other in stacks, but those
// applications are going to have knowledge as to the dependencies and will be
// able to construct them.
//
// In fact, it appears that the inversion of control addition was an effect of
// the plague of this parallel startup in Olio. Never used. Didn't really answer
// the problem. If it did raise itself again, I'd pass a Cubbyhole to the
// constructors and have them share their startup information that way.
//
// What I saw from reworking Olio was that both the test and program examples
// are examples show that everything starts with a call to an anonymous Cadence.
// Adding an anonymous Cadence, which I did without thinking, just by typing,
// and now it appears to be like the test and program examples. The anonymous
// cadence accepts the error callback, but it has the logic to do the countdown
// and to gather the results of the constructor and place them in a bouquet for
// our dear user to inspect and use.

//
function prove (okay) {
    okay(require('..'), 'require')
    return

    function program (raise) {
        var destructible = new Destructible('t/series.t.js')

        var signal = new Signal

        // However your parallel stacks are communicating, you're going to want
        // to be able to push a cancellation though that semaphore if you
        // destruct early.

        //
        destructible.destruct.wait(function () {
            signal.unlatch(new Error('canceled'))
        })

        var children = [cadence(function (async, destructible) {
            async(function () {
                signal.wait(async())
            }, function () {
                return { name: 'first' }
            })
        }), cadence(function (async, destructible) {
            signal.unlatch()
            return { name: 'second' }
        })]

        // So instead of using Destructible as a funnel, we gather up the
        // responses ourselves. This is the essence of turning-the-corner in
        // parallel. If you can find a way to funnel through destructible have
        // at it. If you use a durable constructor callback you're going to
        // trigger the scram mechanism in Destructible. How would you use a
        // durable constructor callback? By creating an ephemeral destructible
        // and then creating durable callbacks on that destructible. You'd pass
        // in the parent destructible as an argument. If you're hanging on the
        // sempahore in our example here than the scarm is going to cause the
        // sempahore to error, but you won't see it in your errors because the
        // error is going to be the hung error, the subsequent cancel error is
        // going to get swallowed. Yes, the scram willl cause the root to close
        // and raise an error from the sempahore, but you won't see it.
        //
        // We could have logic to determine if we're isolated and if we are then
        // we only waited on ourselves to determine if we've hung up. We can
        // then destroy our parent and wait on our parent to cleanup, generating
        // the hung message on the parent's scram and if anything waiting also
        // finished it would appear in our causes. We could add a stage property
        // so that you could see that an error came at destruct or scram. You
        // would be able to see that we hung but we did get our hung messages
        // after scam.
        //
        // You could then use Destructible as a funnel and not lose error
        // messages, but now wouldn't you get duplicate error messages? You're
        // listening on that the base ephemeral destructible, waiting for it to
        // return and if it completes with an error. Well, I guess you can't
        // funnel, because the ephemeral doesn't funnel anyway. You're going to
        // have to gather your results in your constructor mechanism.
        //
        // By constructor mechanism I assume you're wrapping calls to
        // Destructible constructors as is the case below.

        //
        function initializer (children, callback) {
            var count = 0, gathered
            children.forEach(function (child, index) {
                cadence([function () {
                    if (++count == children.length) {
                        callback(null, gathered)
                    }
                }], function () {
                    destructible.durable(index, child, async())
                }, function (child) {
                    gathered[index] = child
                })(destructible.ephemeral([ 'constructor', index ]))
            })
        }

        var ifWeHadPostScramErrors  = cadnece(function (async, ephemeral, durable) {
            var count = 0, gathered = []
            children.forEach(function (child, index) {
                cadence(function () {
                    destructible.durable(index, child, async())
                }, function (child) {
                    gathered[index] = child
                })(ephemeral.durable([ 'constructor', index ]))
            })
            async([function () {
            }, function (error) {
                // Yeah, there's an error, isn't there? Which means if we throw
                // it it is going to repeat itself in the tree. We know we got
                // it so let's throw something else. Or can we just duplicate
                // it? Maybe Interrupt should display duplicates better?
                throw new Error('initialization.failure')
                throw error
            }])
        })

        /// Or maybe our ephemeral is not in the existing tree.
        var createAWholeDestructible  = cadnece(function (async, destructible) {
            var ephemeral = new Destructible('ephemeral')

            var destroy = destructible.destruct.wait(ephemeral, 'destroy')
            ephemeral.destruct.wait(function () { destructible.destruct.cancel(destroy) })

            var count = 0, gathered = []
            children.forEach(function (child, index) {
                cadence(function () {
                    destructible.durable(index, child, async())
                }, function (child) {
                    gathered[index] = child
                })(ephemeral.durable([ 'constructor', index ]))
            })

            ephemeral.errored.wait(destructible, 'destroy')
            ephemeral.drain()

            // Now our error is only reported once or not at all if there is no
            // error. We build our own funnel still. Problem is if we hang we're
            // still going to miss the message, if we do ephemeral constructor
            // callbacks we're going to never complete. For the former we need
            // some sort of post scram wait, dear user gets a scram and does
            // something says, hey give me nother five seconds and then raise
            // your error (complete). For the latter, maybe away to say, hey
            // start counting down, if you get to zero we're done, do like
            // `Destructible.drain`.
            //
            // This is getting closer.
            //
            async(function () {
                ephemeral.completed.wait(async())
            }, function () {
                return [ gathered ]
            })
        })

        // We use a monitor callback to monitor a root function that does not return
        // until we've completed. When it returns the test is destroyed. If any of
        // the constructors throws an error, we catch it in our `test` monitor and
        // report it.

        //
        cadence(function (async) {
            if (raise == 'initializer') {
                throw new Error('initializer')
            }
            destructible.durable('foo', cadence(function (async, destructible) {
                if (raise == 'constructor') {
                    throw new Error('constructor')
                }
                cadence(function () {
                    if (raise == 'runtime') {
                        throw new Error('runtime')
                    }
                    async(function () {
                        // Run our program for a while.
                        setTimeout(async(), 250)
                    }, function () {
                        // Exit our program.
                        return [ 0 ]
                    })
                })(destructible.durable('program'))
            }), async())
        })(destructible.ephemeral('initialize'))
                     // ^^^^^^^ want to have names and fewer magic arguments

        // What should they be.
        //  * callback? task? child? socket? serve? spawn? fork?
        //  * fork and exec, where exec is long running?
        // How about make the move now to naming, but come back and choose the
        // best names only after you've worked with them for a while.

        return destructible
    }
}
