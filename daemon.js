exports.monitor = cadence(function (async, destructible, key, initializer) {
    if (!destructible.destroyed) {
        async([function () {
            initializer(async())
        }, function (error) {
            destructible.destroy()
        }], function (object, listener, destructor) {
            destructible.destruct.wait(object, destructor)
            new Operation([ object, listener ]).call(null, destructible.monitor(key))
        })
    }
})
