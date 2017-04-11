require('proof')(15, require('cadence')(prove))

function prove (async, assert) {
    var Destructible = require('..')
    var destructible = new Destructible('keyed')
    assert(destructible.key, 'keyed', 'keyed')
    var destructible = new Destructible
    assert(destructible.key, null, 'unkeyed')

    var object = { destroyed: false }

    destructible.markDestroyed(object, 'destroyed')
    destructible.addDestructor('destructor', function () {
        assert(true, 'destructor ran')
    })
    destructible.addDestructor('invoked', function () {
        assert(true, 'destructor invoked')
    })
    destructible.addDestructor('removed', function () {
        throw new Error('should not run')
    })
    destructible.invokeDestructor('invoked')
    destructible.removeDestructor('removed')
    assert(destructible.getDestructors(), [ 'destructor' ], 'removed')

    destructible.check()

    async([function () {
        destructible.destructible('a', function (ready, callback) {
            destructible.addDestructor('a', function () { callback () })
            ready.unlatch()
        }, async())
        destructible.destructible(function (ready, callback) {
            callback(new Error('cause'))
        }, async())
    }, function (error) {
        assert(error.message, 'cause', 'error thrown')
        assert(destructible.destroyed, true, 'destroyed')
        assert(object.destroyed, true, 'marked destroyed')

        try {
            destructible.check()
        } catch (error) {
            console.log(error.stack)
            assert(/^destructible#destroyed$/m.test(error.message), 'destroyed')
        }

        destructible.destroy()

        destructible.addDestructor('destroyed', function () {
            assert(true, 'run after destroyed')
        })

        destructible.destructible(function () {
            assert(false, 'should not be called')
        }, async())
    }], [function () {
        destructible = new Destructible
        // First to exit will trigger destroy.
        destructible.async(async, 'a')(function (signal) {
            var callback = async()
            destructible.addDestructor('a', function () { callback() })
            signal.unlatch()
        })
        // When exiting, already destroyed.
        destructible.async(async, 'b')(function (signal) {
            var callback = async()
            destructible.addDestructor('b', function () { callback() })
            signal.unlatch()
        })
        destructible.async(async, 'c')(function (signal) {
            async(function () {
                setImmediate(async())
            }, function () {
                throw new Error('cause')
            })
        })
        // When starting, waiting on previous.
        destructible.async(async, 'd')(function (signal) {
            var callback = async()
            destructible.addDestructor('d', function () { callback() })
            signal.unlatch()
        })
    }, function (error) {
        console.log('>', error.stack)
        assert(error.message, 'cause', 'async error thrown')
        assert(destructible.destroyed, true, 'async destroyed')
        assert(object.destroyed, true, 'async marked destroyed')

        try {
            destructible.check()
        } catch (error) {
            console.log(error.stack)
            assert(/^destructible#destroyed$/m.test(error.message), 'async check')
        }

        destructible.destroy()

        destructible.addDestructor('destroyed', function () {
            assert(true, 'async run after destroyed')
        })

        destructible.async(async, 'x')(function () {
            assert(false, 'should not be called')
        })
    }])
}
