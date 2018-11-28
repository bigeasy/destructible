require('proof')(1, okay)

// The unusual case of constructing children but not be able to spawn the in
// serial. The constructors build objects that depend on each other. The first
// child you build waits on a promise that will deliver the second child you
// build. If you run in serial you will deadlock because you will be waiting for
// the constructor of the first child to complete before you can begin to build
// the second child, but the constructor of the first child is waiting on the
// second child to be constructed.
//
// Assuming we don't know about these depenencies oursleves, because if we did
// we'd just build things in the right order, we need to do program starts in
// parallel, catch an error from the parallel starts, and countdown the starts
// so that we know when we can return.
//
// I'm struggling with this one because it seems like you could create service
// monitor and gather up your errors in the service monitor, if any. The
// service monitor can terminate. The service destructible is used to create
// callacks to give to the constructors. The constructors are constructed using
// the applications destructible.
//
// First issue is that we're now going to timeout on the creation if they don't
// construct in time. Some of them will return destroying our emphemeral
// constructor. Any that don't are going to cause this service to be marked as
// hung. What's wrong with this exactly?
//
// You expect to be able to use the sub-destructible as a way to gather the
// constructed objects because you're able to do that from the serial
// construction.

//
function (okay) {
    okay(require('..'), 'require')
}
