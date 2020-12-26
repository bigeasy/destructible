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
    //

    // ## Recoverable

    // What if a destructible is recoverable? That's on you. A recoverable
    // destructible is one whose strands will catch exceptions and handle them.

    // These exceptions are part of normal operation and the error funnel is the
    // wrong place to record their errors. Imagine you have a network service
    // where you create an ephemeral for each socket and you want to stay
    // running through every sort of error. It would mean that if your
    // application is in a bad state that it might bog down the computer, but
    // you're not concerned about individual computers. You have fancy
    // monitoring that will go straight to your pager to alert you when things
    // go out of hand, and dashboards galore to survey the wreckage.

    // In this case, you really don't want a bunch of errors building up in the
    // destructible tree. You catch the exceptions and send them out an
    // alternlate logging direction.

    // What if you want ensure that something will initialize. Perhaps you have
    // a database common service and it wants to read a directory of data. If
    // the data is corrupt it will raise an exception, but there is a recovery
    // process that might fix the corruption completely and with certainty, so
    // you can ...

    //
    return
    {
        for (;;) {
            try {
                const opening = await Directory.open(directory)
                return await opening.construct(destructible.durable('database'))
            } catch (error) {
                if (error instanceof CorruptionError) {
                    await Database.recover(directory)
                    continue
                } else {
                    throw error
                }
            }
        }
    }
    //

    // Okay, so we put something in the destructible tree once we are certain
    // that it can survive in the tree. Destructible still abides by the premise
    // of exploding processes, fail fast and fail completely, let the operating
    // system sort it out.
})
