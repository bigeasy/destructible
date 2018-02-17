require('proof')(18, require('cadence')(prove))

function prove (async, okay) {
    var Destructible = require('..')

    var destructible = new Destructible('bad')

    destructible.destruct.wait(function () { throw new Error('bad') })
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

    destructible.destroy()
    okay(destructible.destroyed, 'marked destroyed')
    destructible.destroy()

    function Daemon () {
        this._callback = null
    }

    Daemon.prototype.destroy = function () {
        this._callback.call()
    }

    Daemon.prototype.listen = function (value, initializer, callback) {
        console.log(arguments)
        okay(value, 1, 'listening')
        this._callback = callback
        initializer.destructor(this, 'destroy')
        initializer.destructible().destruct.wait(this, function () {
            okay(true, 'sub-destructible destruct one')
        })
        initializer.destructible().destruct.wait(this, function () {
            okay(true, 'sub-destructible destruct two')
        })
        var cookie = initializer.destructor(function () { okay(true, 'canceled') })
        initializer.cancel(cookie)()
        initializer.ready()
    }

    async(function () {
        var destructible = new Destructible('daemons')
        var daemon = new Daemon
        async(function () {
            destructible.monitor('daemon', daemon, 'listen', 1, async())
        }, function () {
            destructible.destroy()
            destructible.completed.wait(async())
        }, [function () {
            destructible.monitor('daemon', daemon, 'listen', 1, async())
        }, function (error) {
            okay(error.message, 'destructible#destroyed', 'already destroyed')
        }])
    }, function () {
        destructible = new Destructible('timeout')
        async(function () {
            destructible.monitor('timeout canceled', 60000, function (initializer, callback) {
                initializer.ready()
                callback()
            }, async())
        }, function () {
            destructible.completed.wait(async())
        })
    }, function () {
        var destructible = new Destructible('timeout')
        async([function () {
            destructible.monitor('timedout', 250, function (initializer, callback) {
            }, async())
        }, function (error) {
            okay(error.message, 'destructible#timeout', 'timeout')
        }], [function () {
            destructible.completed.wait(async())
        }, function (error) {
            okay(error.message, 'destructible#timeout', 'timeout completed')
        }])
    }, function () {
        var destructible = new Destructible('child')
        var child = destructible.destructible('child')
        child.destruct.wait(function () {
            okay(true, 'child called')
        })
        destructible.destroy()
    }, function () {
        destructible = new Destructible('daemons')
        async([function () {
            destructible.monitor('errored', function (initializer, callback) {
                initializer.destructor(callback)
            }, async())
            destructible.monitor('abend')(new Error('errored'))
        }, function (error) {
            okay(error.message, 'errored', 'ready error')
        }])
    }, function () {
        destructible = new Destructible('daemons')
        async([function () {
            destructible.monitor('errored', function (initializer, callback) {
                initializer.destructor(callback)
            }, async())
            destructible.destroy()
        }, function (error) {
            okay(error.message, 'destructible#unready', 'not ready')
        }])
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
        callbacks.push(destructible.monitor(2, true))
        callbacks.push(destructible.monitor(3, true))
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
