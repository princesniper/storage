import { POST as upload } from "../route";

export async function POST(req: Request) {
    const response = await upload(req);
    if (response.status !== 201) return response;
    return new Response(response.body, {
        status: 200,
        headers: response.headers,
    });
}
