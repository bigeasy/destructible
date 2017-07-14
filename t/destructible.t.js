require('proof')(10, require('cadence')(prove))

function prove (async, assert) {
    var Destructible = require('..')

    var destructible = new Destructible('bad')

    destructible.addDestructor('bad', function () { throw new Error })

    try {
        destructible.destroy()
    } catch (error) {
        assert(/^destructible#destructor$/m.test(error.message), 'bad destructor')
    }

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
    assert(destructible.getDestructors(), [ 'markDestroyed', 'destructor' ], 'removed')

    destructible.destroy()
    destructible.destroy()

    destructible.addDestructor('after', function () {
        assert(true, 'after')
    })

    async(function () {
        destructible = new Destructible('responses')
        destructible.completed(async())
        var callbacks = []
        callbacks.push(destructible.rescue(0, function () { assert(true, 'done') }))
        callbacks.push(destructible.monitor(1))
        callbacks.push(destructible.monitor(2))
        callbacks.pop()(null, 2, 3)
        callbacks.pop()(null, 1)
        callbacks.pop()()
    }, function (one, two, three) {
        assert([ one, two, three ], [ 1, 2, 3 ], 'responses')
    }, [function () {
        destructible = new Destructible('errors')
        destructible.completed(1000, async())
        var callbacks = []
        callbacks.push(destructible.monitor(1))
        callbacks.push(destructible.rescue(2))
        callbacks.push(destructible.rescue(3))
        callbacks.pop()()
        callbacks.pop()(new Error('caught'))
        callbacks.pop()()
    }, function (error) {
        assert(error.message, 'caught')
    }])
}
