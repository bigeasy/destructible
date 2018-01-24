require('proof')(12, require('cadence')(prove))

function prove (async, okay) {
    var Destructible = require('..')

    var destructible = new Destructible('bad')

    destructible.addDestructor('bad', function () { throw new Error('bad') })
    destructible.completed.wait(function (error) {
        okay(error.message, 'bad','bad destructor')
    })
    destructible.destroy()

    var destructible = new Destructible('error')
    destructible.destruct.wait(function () { throw new Error('destruct') })
    destructible.destroy()
    okay(destructible.errors[0].message, 'destruct', 'destruct error')

    var destructible = new Destructible('keyed')
    okay(destructible.key, 'keyed', 'keyed')
    var destructible = new Destructible
    okay(destructible.key, null, 'unkeyed')

    var object = { destroyed: false }

    destructible.markDestroyed(object, 'destroyed')
    destructible.addDestructor('destructor', function () {
        okay(true, 'destructor ran')
    })
    destructible.addDestructor('invoked', function () {
        okay(true, 'destructor invoked')
    })
    destructible.addDestructor('removed', function () {
        throw new Error('should not run')
    })
    destructible.invokeDestructor('invoked')
    destructible.invokeDestructor('invoked')
    destructible.removeDestructor('removed')
    okay(destructible.getDestructors(), [ 'markDestroyed', 'destructor' ], 'removed')

    destructible.destroy()
    destructible.destroy()

    destructible.addDestructor('after', function () {
        okay(true, 'after')
    })

    function Daemon () {
        this._callback = null
    }

    Daemon.prototype.destroy = function () {
        this._callback.call()
    }

    Daemon.prototype.listen = function (value, callback) {
        okay(value, 1, 'listening')
        this._callback = callback
    }

    async(function () {
        destructible = new Destructible('daemons')
        var daemon = new Daemon
        destructible.monitor('daemon', daemon, 'listen', 1, 'destroy')
        destructible.destroy()
        destructible.completed.wait(async())
    }, function () {
        destructible = new Destructible('responses')
        destructible.completed.wait(async())
        destructible.monitor(1)()
    }, function () {
        okay(true, 'normal done')
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
        okay(error.message, 'caught', 'caught')
    }], [function () {
        destructible = new Destructible(50, 'timeout')
        destructible.completed.wait(async())
        var callbacks = []
        callbacks.push(destructible.monitor(1))
        callbacks.push(destructible.monitor(2))
        callbacks.pop()()
    }, function (error) {
        okay(/^destructible#hung$/m.test(error.message), 'timeout')
    }])
}
