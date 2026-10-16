// TODO-3: implement the Clustered Deferred fullscreen vertex shader

// This shader should be very simple as it does not need all of the information passed by the the naive vertex shader.

// one big triangle that covers the whole screen (the parts outside get clipped), no vertex buffer needed
const corners = array<vec2f, 3>(
    vec2f(-1, -1), // bottom left
    vec2f( 3, -1), // far off to the right
    vec2f(-1,  3)  // far off to the top
);

@vertex
fn main(@builtin(vertex_index) vertexIdx: u32) -> @builtin(position) vec4f
{
    return vec4f(corners[vertexIdx], 0, 1);
}
