require('proof')(20, require('cadence')(prove))

function prove (async, okay) {
    var Destructible = require('..')

    var destructible = new Destructible('bad')

    destructible.destruct.wait(function () { throw new Error('bad') })
    destructible.completed.wait(function (error) {
        okay(error.cause.message, 'bad','bad destructor')
    })
    destructible.destroy()

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

    Daemon.prototype.listen = function (destructible, value, callback) {
        okay(value, 1, 'listening')
        this._callback = destructible.monitor('main')
        destructible.destruct.wait(this, 'destroy')
        destructible.destruct.wait(this, function () {
            okay(true, 'sub-destructible destruct one')
        })
        destructible.destruct.wait(this, function () {
            okay(true, 'sub-destructible destruct two')
        })
        var cookie = destructible.destruct.wait(function () { okay(true, 'canceled') })
        destructible.destruct.cancel(cookie)()
        callback()
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
            okay(error.qualified, 'destructible#destroyed', 'already destroyed')
        }])
    }, function () {
        destructible = new Destructible('daemons')
        async(function () {
            destructible.monitor('destroyed', function (destructible, callback) {
                setImmediate(function () { destructible.destroy() })
                callback()
            }, null)
            destructible.completed.wait(async())
        }, function () {
            okay(destructible.destroyed, 'hard fork')
        })
    }, function () {
        // We should be able to reach `okay` without having to explicitly
        // destroy the parent Destructible, the child exiting will trigger
        // `destroy` in the parent.
        destructible = new Destructible('daemons')
        async(function () {
            destructible.monitor('destroyed', function (destructible, callback) {
                setImmediate(function () { destructible.destroy() })
                callback()
            }, async())
        }, function () {
            destructible.completed.wait(async())
        }, function () {
            okay(destructible.destroyed, 'parent destroyed')
        })
    }, function () {
        // Here we're testing what happpens when we destroy immediately.
        // destroy the parent Destructible, the child exiting will trigger
        // `destroy` in the parent.
        destructible = new Destructible('daemons')
        async(function () {
            destructible.monitor('destroyed', function (destructible, callback) {
                destructible.destroy()
                callback()
            }, async())
        }, function () {
            okay(destructible.destroyed, 'parent destroyed immediately')
            destructible.completed.wait(async())
        })
    }, function () {
        destructible = new Destructible('daemons')
        destructible.completed.wait(async())
        async(function () {
            destructible.monitor('destroyed', true, function (destructible, callback) {
                destructible.destroy()
                callback()
            }, async())
        }, function () {
            okay(!destructible.destroyed, 'parent spared')
            destructible.destroy()
            destructible.completed.wait(async())
        })
    }, function () {
        var destructible = new Destructible('scrammed')
        async(function () {
            destructible.monitor('sub-scrammed', function (initializer, callback) {
                initializer.monitor('hung')
                callback()
            }, async())
        }, [function () {
            destructible.destroy()
            destructible.completed.wait(async())
        }, function (error) {
            okay(error.cause.qualified, 'destructible#hung', 'sub scram')
            destructible.scram()
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
            destructible.monitor('errored', function (destructible, callback) {
                destructible.destruct.wait(callback)
            }, async())
            destructible.monitor('abend')(new Error('errored'))
        }, function (error) {
            okay(error.cause.message, 'errored', 'ready error')
        }])
    }, function () {
        destructible = new Destructible('daemons')
        async([function () {
            destructible.monitor('errored', function (destructible, callback) {
                destructible.destruct.wait(callback)
            }, async())
            destructible.destroy()
        }, function (error) {
            okay(error.message, 'destructible#unready', 'not ready')
        }])
    }, function () {
        destructible = new Destructible('ordinate')
        var subordinate = new Destructible('subordinate')
        subordinate.destruct.wait(function () {
            okay(true, 'subordinate done')
        })
        var monitor = subordinate.monitor('monitoring')
        async(function () {
            destructible.monitor('subordinate', subordinate, 'subordinate', async())
        }, function () {
            destructible.destruct.wait(async())
            monitor()
        }, function () {
            okay(true, 'subordinate supervisor done')
        })
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
        okay(error.cause.message, 'caught', 'caught')
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
