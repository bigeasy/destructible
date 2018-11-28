require('proof')(20, require('cadence')(prove))

function prove (async, okay) {
    var Destructible = require('..')

    var destructible = new Destructible('bad')

    destructible.destruct.wait(function () { throw new Error('bad') })
    destructible.completed.wait(function (error) {
        console.log(error.stack)
        okay(error.causes[0].message, 'bad','bad destructor')
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
        this._callback = destructible.durable('main')
        destructible.destruct.wait(this, 'destroy')
        destructible.destruct.wait(this, function () {
            okay('sub-destructible destruct one')
        })
        destructible.destruct.wait(this, function () {
            okay('sub-destructible destruct two')
        })
        var cookie = destructible.destruct.wait(function () { okay('canceled') })
        destructible.destruct.cancel(cookie)()
        callback()
    }

    var cadence = require('cadence')

    async(function () {
        var destructible = new Destructible('daemons')
        var daemon = new Daemon
        async(function () {
            destructible.durable('daemon', daemon, 'listen', 1, async())
        }, function () {
            destructible.destroy()
            destructible.completed.wait(async())
        }, [function () {
            destructible.durable('daemon', daemon, 'listen', 1, async())
        }, function (error) {
            okay(error.qualified, 'destructible#destroyed', 'already destroyed')
        }])
    }, function () {
        destructible = new Destructible('daemons')
        async(function () {
            destructible.durable('destroyed', function (destructible, callback) {
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
            destructible.durable('destroyed', function (destructible, callback) {
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
            destructible.durable('destroyed', function (destructible, callback) {
                destructible.destroy()
                callback()
            }, async())
        }, function () {
            okay(destructible.destroyed, 'parent destroyed immediately')
            destructible.completed.wait(async())
        })
    }, function () {
        console.log('--- xxxx ---')
        destructible = new Destructible('daemons')
        destructible.completed.wait(async())
        async(function () {
            destructible.ephemeral('destroyed', function (destructible, callback) {
                destructible.destroy()
                callback()
            }, async())
        }, function () {
            okay(!destructible.destroyed, 'parent spared')
            destructible.destroy()
            destructible.completed.wait(async())
        })
    }, [function () {
        destructible = new Destructible('daemons')
        destructible.completed.wait(async())
        destructible.ephemeral('destroyed', function (destructible, callback) {
            var monitor = destructible.durable('exploded')
            setImmediate(function () { monitor(new Error('early')) })
            callback()
        }, async())
    }, function (error) {
        okay(error.causes[0].causes[0].message, 'early', 'terminates error')
    }], [function () {
        destructible = new Destructible('daemons')
        destructible.completed.wait(async())
        destructible.durable('nested', cadence(function (async) {
            async([function () {
                destructible.ephemeral('destroyed', function (destructible, callback) {
                    callback(new Error('nope'))
                }, async())
            }, function (error) {
                okay(error.message, 'nope', 'initialization exception')
                throw error
            }])
        }), null)
    }, function (error) {
        okay(error.causes[0].message, 'nope', 'initalization')
    }], function () {
        var destructible = new Destructible('scrammed')
        async(function () {
            destructible.durable('sub-scrammed', function (destructible, callback) {
                destructible.durable('hung')
                callback()
            }, async())
        }, [function () {
            destructible.destroy()
            destructible.completed.wait(async())
        }, function (error) {
            console.log(error.stack)
            okay(error.causes[0].qualified, 'destructible#scrammed', 'sub scram')
            destructible.scram()
        }])
    }, function () {
        destructible = new Destructible('daemons')
        async([function () {
            destructible.durable('errored', function (destructible, callback) {
                destructible.destruct.wait(callback)
            }, async())
            destructible.durable('abend')(new Error('errored'))
        }, function (error) {
            okay(error.cause.message, 'errored', 'ready error')
        }])
    }, function () {
        destructible = new Destructible('daemons')
        async([function () {
            destructible.durable('errored', function (destructible, callback) {
                destructible.destruct.wait(callback)
            }, async())
            destructible.destroy()
        }, function (error) {
            okay(error.message, 'destructible#unready', 'not ready')
        }])
    }, function () {
        destructible = new Destructible('responses')
        destructible.completed.wait(async())
        destructible.durable(1)()
    }, function () {
        okay('normal done')
    }, [function () {
        destructible = new Destructible('errors')
        destructible.completed.wait(async())
        var callbacks = []
        callbacks.push(destructible.durable(1))
        callbacks.push(destructible.ephemeral(2))
        callbacks.push(destructible.ephemeral(3))
        callbacks.pop()()
        callbacks.pop()(new Error('caught'))
        callbacks.pop()()
    }, function (error) {
        okay(error.causes[0].message, 'caught', 'caught')
    }], [function () {
        destructible = new Destructible(50, 'timeout')
        destructible.completed.wait(async())
        var callbacks = []
        callbacks.push(destructible.durable(1))
        callbacks.push(destructible.durable(2))
        callbacks.pop()()
    }, function (error) {
        okay(/^destructible#scrammed$/m.test(error.message), 'timeout')
    }])
}
