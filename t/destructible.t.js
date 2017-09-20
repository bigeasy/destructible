require('proof')(10, require('cadence')(prove))

function prove (async, assert) {
    var Destructible = require('..')

    var destructible = new Destructible('bad')

    destructible.addDestructor('bad', function () { throw new Error('bad') })
    destructible.completed.wait(function (error) {
        assert(error.message, 'bad','bad destructor')
    })
    destructible.destroy()

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
        destructible.completed.wait(async())
        destructible.monitor(1)()
    }, function () {
        assert(true, 'normal done')
    }, [function () {
        destructible = new Destructible('errors')
        destructible.completed.wait(async())
        var callbacks = []
        callbacks.push(destructible.monitor(1))
        callbacks.push(destructible.rescue(2))
        callbacks.push(destructible.rescue(3))
        callbacks.pop()()
        callbacks.pop()(new Error('caught'))
        callbacks.pop()()
    }, function (error) {
        assert(error.message, 'caught', 'caught')
    }], [function () {
        destructible = new Destructible(50, 'timeout')
        destructible.completed.wait(async())
        var callbacks = []
        callbacks.push(destructible.monitor(1))
        callbacks.push(destructible.monitor(2))
        callbacks.pop()()
    }, function (error) {
        assert(/^destructible#hung$/m.test(error.message), 'timeout')
    }])
}
