require('proof')(4, prove)

// Common case of using Destructible in a unit test to monitor multiple
// concurrent actions that are all going to end when the test ends.

//
function prove (okay, callback) {
    var Destructible = require('..')
    var cadence = require('cadence')

    function program (raise) {
        var destructible = new Destructible('t/series.t.js')


        // We use a monitor callback to monitor a root function that does not return
        // until we've completed. When it returns the test is destroyed. If any of
        // the constructors throws an error, we catch it in our `test` monitor and
        // report it.

        //
        cadence(function (async) {
            if (raise == 'initializer') {
                throw new Error('initializer')
            }
            destructible.monitor('foo', cadence(function (async, destructible) {
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
                })(destructible.monitor('program'))
            }), async())
        })(destructible.monitor('initialize', true))
                     // ^^^^^^^ want to have names and fewer magic arguments

        // What should they be.
        //  * callback? task? child? socket? serve? spawn? fork?
        //  * fork and exec, where exec is long running?
        // How about make the move now to naming, but come back and choose the
        // best names only after you've worked with them for a while.

        return destructible
    }

    cadence(function (async) {
        async(function () {
            program().completed.wait(async())
        }, function (value) {
            okay(value, 0, 'no error')
        }, [function () {
            program('initializer').completed.wait(async())
        }, function (error) {
            okay({
                key: error.contexts[0].key,
                message: error.causes[0].message
            }, {
                key: 'initialize',
                message: 'initializer'
            }, 'initializer error')
        }], [function () {
            program('constructor').completed.wait(async())
        }, function (error) {
            okay({
                key: error.contexts[0].key,
                message: error.causes[0].message
            }, {
                key: 'initialize',
                message: 'constructor'
            }, 'constructor error')
        }], [function () {
            program('runtime').completed.wait(async())
        }, function (error) {
            okay({
                key: error.contexts[0].key,
                message: error.causes[0].causes[0].message
            }, {
                key: 'foo',
                message: 'runtime'
            }, 'runtime error')
        }])
    })(callback)
}
