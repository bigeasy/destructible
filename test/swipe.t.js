require('proof')(1, async okay => {
    const Destructible = require('..')
    //

    // The `opertional` test accepts an additional boolean for staged shutdowns.
    // This allows use to assert that the Destructible is destroyed and that
    // some additional application specific shutdown condition is true.

    // The given condition is tested and `&&`ed with `destroyed` because you
    // should not report a `DESTORYED` exception if the underlying
    // Destructible's `destroyed` is not true.

    //
    {
        const destructible = new Destructible('example')
        destructible.destroy()

        destructible.operational(false)

        try {
            destructible.operational(true)
        } catch (error) {
            okay((error instanceof Destructible.Error) && error.code == 'DESTROYED', 'destructible was destroyed')
        }
    }
})
