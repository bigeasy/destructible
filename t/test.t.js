require('proof')(1, prove)

// Common case of using Destructible in a unit test to monitor multiple
// concurrent actions that are all going to end when the test ends.

//
function prove (okay, callback) {
    var Destructible = require('..')

    var destructible = new Destructible('t/series.t.js')

    destructible.completed.wait(function (error) {
        okay(error.causes[0].message, 'foo')
        callback()
    })

    var cadence = require('cadence')

    // We use a monitor callback to monitor a root function that does not return
    // until we've completed. When it returns the test is destroyed. If any of
    // the constructors throws an error, we catch it in our `test` monitor and
    // report it.
    //
    // In our example here the test fails by raising an exception. We should be
    // able to see that exception as a cause in `completed`.

    //
    cadence(function (async) {
        destructible.monitor('foo', cadence(function (async, destructible) {
            throw new Error('foo')
        }), async())
    })(destructible.monitor('test'))
}
