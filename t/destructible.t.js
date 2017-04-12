require('proof')(23, require('cadence')(prove))

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
        destructible.stack('a', function (ready, callback) {
            destructible.addDestructor('a', callback)
            ready.unlatch()
        }, async())
        destructible.stack('b', function (ready, callback) {
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

        destructible.stack('c', function () {
            assert(false, 'should not be called')
        }, async())
    }], [function () {
        destructible = new Destructible
        // First to exit will trigger destroy.
        destructible.stack(async, 'a')(function (signal) {
            var callback = async()
            destructible.addDestructor('a', callback)
            signal.unlatch()
        })
        // When exiting, already destroyed.
        destructible.stack(async, 'b')(function (signal) {
            var callback = async()
            destructible.addDestructor('b', callback)
            signal.unlatch()
        })
        destructible.stack(async, 'c')(function (signal) {
            async(function () {
                setTimeout(async(), 1)
            }, function () {
                throw new Error('cause')
            })
        })
        // When starting, waiting on previous.
        destructible.stack(async, 'd')(function (signal) {
            var callback = async()
            destructible.addDestructor('d', callback)
            signal.unlatch()
        })
    }, function (error) {
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

        destructible.stack(async, 'x')(function () {
            assert(false, 'should not be called')
        })
    }], function () {
        destructible = new Destructible
        destructible.rescue(function (callback) {
            assert(true, 'rescue called')
            callback()
        }, async())
        destructible.rescue(async)(function () {
            assert(true, 'async rescue called')
        })
    }, [function () {
        destructible.rescue(function () {
            throw new Error('cause')
        }, async())
    }, function (error) {
        assert(error.message, 'cause', 'rescue thrown')
        assert(destructible.destroyed, 'rescue destroyed')
    }], function () {
        destructible = new Destructible
        destructible.rescue()()
        assert(!destructible.destroyed, 'rescue notify')
        destructible.rescue()(new Error('cause'))
        assert(destructible.destroyed, 'rescue notifyed of error')
        assert(destructible.cause.message, 'cause', 'rescue notify error')
    }, [function () {
        destructible = new Destructible
        destructible.stack(async, 'x')(function (ready) {
            async(function () {
                setImmediate(async())
            }, function () {
                ready.unlatch()
            })
        })
        destructible.rescue(async)(function () {
            throw new Error('first')
        })
        destructible.rescue(async)(function () {
            throw new Error('second')
        })
    }, function (error) {
        assert(destructible.cause.message, 'first', 'error race')
    }])
}
